from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.planning import MachineSchedule, PlanningOperation, PlanningScheduleSegment

logger = logging.getLogger(__name__)

OFFICIAL_KIOSK_MACHINE_CODES: tuple[str, ...] = (
    "CLX450",
    "CMX600",
    "CTX800",
    "EXPEDICE",
    "HAASST40",
    "HAASVF3",
    "KONTROLA",
    "LASER",
    "NEF400-1",
    "NEF400-2",
    "PILA",
    "RUCNI",
    "SABLT42",
    "SABLT52",
    "SU50",
    "SKLAD",
)

OFFICIAL_KIOSK_MACHINE_CODE_SET = frozenset(OFFICIAL_KIOSK_MACHINE_CODES)

LEGACY_KIOSK_MACHINE_CODE_MAP: dict[str, str] = {
    "CLX_450_TC": "CLX450",
    "HAAS_ST40": "HAASST40",
    "CMX_600_V": "CMX600",
    "CTX_BETA_800": "CTX800",
    "SAB_LT52": "SABLT52",
    "SAB_LT42": "SABLT42",
    "SU_50": "SU50",
    "BALENI": "EXPEDICE",
    "MEZIOPERACNI_KONTROLA": "KONTROLA",
    "VYSTUPNI_KONTROLA": "KONTROLA",
    "NEFF_I": "NEF400-1",
    "NEFF_II": "NEF400-2",
    "PRACKA": "RUCNI",
    "PRIJEM_SKLAD": "SKLAD",
    "VYDEJ_SKLAD": "SKLAD",
}

READABLE_KIOSK_MACHINE_NAMES: dict[str, str] = {
    "CLX450": "CLX 450",
    "CMX600": "CMX 600",
    "CTX800": "CTX 800",
    "EXPEDICE": "Expedice",
    "HAASST40": "HAAS ST-40",
    "HAASVF3": "HAAS VF-3",
    "KONTROLA": "Kontrola",
    "LASER": "Laser",
    "NEF400-1": "NEF 400-1",
    "NEF400-2": "NEF 400-2",
    "PILA": "Pila",
    "RUCNI": "Rucni",
    "SABLT42": "SAB LT42",
    "SABLT52": "SAB LT52",
    "SU50": "SU 50",
    "SKLAD": "Sklad",
}


def normalize_machine_code_text(machine_code: str | None) -> str:
    return (machine_code or "").strip().upper()


def resolve_official_kiosk_machine_code(machine_code: str | None) -> str:
    code = normalize_machine_code_text(machine_code)
    return LEGACY_KIOSK_MACHINE_CODE_MAP.get(code, code)


def _machines_by_code(db: Session, machine_code: str) -> list[Machine]:
    code = normalize_machine_code_text(machine_code)
    return list(
        db.scalars(
            select(Machine)
            .where(func.upper(func.trim(Machine.machine_code)) == code)
            .order_by(Machine.is_active.desc(), Machine.id.asc())
        ).all()
    )


def _choose_target_machine(
    db: Session, target_code: str, source_codes: Iterable[str]
) -> tuple[Machine | None, str | None]:
    target_rows = _machines_by_code(db, target_code)
    if target_rows:
        return target_rows[0], None
    candidates: list[Machine] = []
    for source_code in source_codes:
        candidates.extend(_machines_by_code(db, source_code))
    if not candidates:
        return None, None
    candidates.sort(key=lambda m: (not bool(m.is_active), int(m.id or 0)))
    target = candidates[0]
    old_code = normalize_machine_code_text(target.machine_code)
    target.machine_code = target_code
    target.name = (target.name or "").strip() or READABLE_KIOSK_MACHINE_NAMES[target_code]
    return target, old_code


def _activate_official_machine(machine: Machine, target_code: str) -> None:
    machine.machine_code = target_code
    machine.name = (machine.name or "").strip() or READABLE_KIOSK_MACHINE_NAMES[target_code]
    machine.is_active = True
    machine.planning_enabled = True
    machine.is_plannable = True
    machine.default_shift_minutes = int(machine.default_shift_minutes or 450)


def _move_machine_references(db: Session, source_id: int, target_id: int) -> dict[str, int]:
    moved_ops = int(
        db.execute(
            update(PlanningOperation)
            .where(PlanningOperation.machine_id == source_id)
            .values(machine_id=target_id)
        ).rowcount
        or 0
    )
    moved_schedule = int(
        db.execute(
            update(MachineSchedule)
            .where(MachineSchedule.machine_id == source_id)
            .values(machine_id=target_id)
        ).rowcount
        or 0
    )
    moved_segments = int(
        db.execute(
            update(PlanningScheduleSegment)
            .where(PlanningScheduleSegment.machine_id == source_id)
            .values(machine_id=target_id)
        ).rowcount
        or 0
    )
    return {
        "moved_ops": moved_ops,
        "moved_schedule": moved_schedule,
        "moved_segments": moved_segments,
    }


def _disable_source_machine(machine: Machine) -> None:
    machine.is_active = False
    machine.planning_enabled = False
    machine.is_plannable = False


def normalize_kiosk_machine_codes(db: Session) -> dict[str, int]:
    """
    Idempotently normalize legacy kiosk machine rows to official AKENG codes.

    No machine rows are deleted. If an official target already exists, references from
    legacy rows are moved to that target and the source rows are disabled.
    """
    summary = {
        "mapped_rows": 0,
        "created_rows": 0,
        "moved_ops": 0,
        "moved_schedule": 0,
        "moved_segments": 0,
    }
    sources_by_target: dict[str, list[str]] = {}
    for old_code, target_code in LEGACY_KIOSK_MACHINE_CODE_MAP.items():
        sources_by_target.setdefault(target_code, []).append(old_code)

    for target_code, source_codes in sources_by_target.items():
        target, renamed_old_code = _choose_target_machine(db, target_code, source_codes)
        if target is None:
            continue
        db.flush()
        _activate_official_machine(target, target_code)
        target_id = int(target.id)
        if renamed_old_code is not None and renamed_old_code != target_code:
            summary["mapped_rows"] += 1
            logger.info(
                "[kiosk_machine_normalization] mapped old_code=%s target_code=%s moved_ops=%s "
                "moved_schedule=%s moved_segments=%s source_machine_id=%s target_machine_id=%s",
                renamed_old_code,
                target_code,
                0,
                0,
                0,
                target_id,
                target_id,
            )

        for old_code in source_codes:
            for source in _machines_by_code(db, old_code):
                if int(source.id) == target_id:
                    continue
                moved = _move_machine_references(db, int(source.id), target_id)
                _disable_source_machine(source)
                summary["mapped_rows"] += 1
                summary["moved_ops"] += moved["moved_ops"]
                summary["moved_schedule"] += moved["moved_schedule"]
                summary["moved_segments"] += moved["moved_segments"]
                logger.info(
                    "[kiosk_machine_normalization] mapped old_code=%s target_code=%s moved_ops=%s "
                    "moved_schedule=%s moved_segments=%s source_machine_id=%s target_machine_id=%s",
                    old_code,
                    target_code,
                    moved["moved_ops"],
                    moved["moved_schedule"],
                    moved["moved_segments"],
                    source.id,
                    target_id,
                )

    for code in OFFICIAL_KIOSK_MACHINE_CODES:
        rows = _machines_by_code(db, code)
        if rows:
            _activate_official_machine(rows[0], code)
            for duplicate in rows[1:]:
                moved = _move_machine_references(db, int(duplicate.id), int(rows[0].id))
                _disable_source_machine(duplicate)
                summary["mapped_rows"] += 1
                summary["moved_ops"] += moved["moved_ops"]
                summary["moved_schedule"] += moved["moved_schedule"]
                summary["moved_segments"] += moved["moved_segments"]
            continue
        db.add(
            Machine(
                machine_code=code,
                name=READABLE_KIOSK_MACHINE_NAMES[code],
                machine_type="WORKCENTER",
                planning_enabled=True,
                is_active=True,
                default_shift_minutes=450,
                is_plannable=True,
            )
        )
        summary["created_rows"] += 1

    db.flush()
    return summary
