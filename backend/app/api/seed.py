from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Machine
from app.models.planning import PlanningOperation, MachineCalendar, MachineSchedule
from app.models.kiosk import Employee, Kiosk

router = APIRouter()


def get_or_create_machine(db: Session, machine_code: str, name: str, machine_type: str = "WORKCENTER"):
    machine = db.scalar(select(Machine).where(Machine.machine_code == machine_code))
    if not machine:
        machine = Machine(
            machine_code=machine_code,
            name=name,
            machine_type=machine_type,
        )
        db.add(machine)
        db.flush()
    return machine


@router.post("/akeng-core")
def seed_akeng_core(db: Session = Depends(get_db)):
    machines = [
        ("PILA", "Pila"),
        ("LASER", "Laser"),
        ("SU_50", "SU-50"),
        ("HAAS_ST40", "HAAS ST40"),
        ("SAB_LT52", "SAB-LT52"),
        ("SAB_LT42", "SAB-LT42"),
        ("PRACKA", "Pracka"),
        ("CLX_450_TC", "CLX 450 TC"),
        ("CTX_BETA_800", "CTX BETA 800"),
        ("NEFF_I", "NEFF I (leva)"),
        ("NEFF_II", "NEFF II (prava)"),
        ("CMX_600_V", "CMX 600 V"),
        ("MEZIOPERACNI_KONTROLA", "Mezioperacni kontrola"),
        ("VYSTUPNI_KONTROLA", "Vystupni kontrola"),
        ("EXPEDICE", "Expedice"),
        ("BALENI", "Baleni"),
        ("PRIJEM_SKLAD", "Prijem sklad"),
        ("VYDEJ_SKLAD", "Vydej sklad"),
    ]

    for code, name in machines:
        get_or_create_machine(db, code, name)

    employees = [
        {"employee_code": "E001", "name": "Petr Novak", "card_uid": "CARD001"},
        {"employee_code": "E002", "name": "Martin Svoboda", "card_uid": "CARD002"},
    ]

    for row in employees:
        exists = db.scalar(select(Employee).where(Employee.employee_code == row["employee_code"]))
        if not exists:
            db.add(Employee(**row, is_active=True))

    kiosk_rows = [
        ("KIOSK_PILA", "Kiosk Pila", "PILA"),
        ("KIOSK_CTX_BETA_800", "Kiosk CTX Beta 800", "CTX_BETA_800"),
        ("KIOSK_CLX_450_TC", "Kiosk CLX 450 TC", "CLX_450_TC"),
        ("KIOSK_CMX_600_V", "Kiosk CMX 600 V", "CMX_600_V"),
    ]

    for kiosk_code, kiosk_name, machine_code in kiosk_rows:
        machine = db.scalar(select(Machine).where(Machine.machine_code == machine_code))
        if machine:
            exists = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == kiosk_code))
            if not exists:
                db.add(
                    Kiosk(
                        kiosk_code=kiosk_code,
                        name=kiosk_name,
                        machine_id=machine.id,
                        is_active=True,
                    )
                )

    today = date.today()
    all_machines = db.scalars(select(Machine)).all()

    for machine in all_machines:
        for i in range(10):
            d = today + timedelta(days=i)
            exists = db.scalar(
                select(MachineCalendar)
                .where(MachineCalendar.machine_id == machine.id)
                .where(MachineCalendar.calendar_date == d)
            )
            if not exists:
                db.add(
                    MachineCalendar(
                        machine_id=machine.id,
                        calendar_date=d,
                        available_minutes=450,
                        planned_minutes=0,
                        maintenance_minutes=0,
                        reserved_minutes=0,
                        is_working_day=True,
                        is_machine_available=True,
                        note=None,
                    )
                )

    db.commit()
    return {"status": "ok", "machines_seeded": len(machines)}


@router.post("/demo-planning-data")
def seed_demo_planning_data(db: Session = Depends(get_db)):
    db.execute(delete(MachineSchedule))
    db.execute(delete(PlanningOperation))
    db.commit()

    pila = db.scalar(select(Machine).where(Machine.machine_code == "PILA"))
    ctx = db.scalar(select(Machine).where(Machine.machine_code == "CTX_BETA_800"))
    cmx = db.scalar(select(Machine).where(Machine.machine_code == "CMX_600_V"))

    demo_rows = [
        {
            "order_item_id": 1,
            "work_order_no": "VP260001",
            "gpn": "302887",
            "qty": 25,
            "diameter": 90,
            "ops": [
                (10, "Rezani", pila.id, 12, 10.0, 22.0, "planned", 1),
                (20, "Soustruzeni", ctx.id, 35, 150.0, 185.0, "planned", 1),
                (30, "Frezovani", cmx.id, 18, 40.0, 58.0, "waiting_release", None),
            ],
        },
        {
            "order_item_id": 2,
            "work_order_no": "VP260002",
            "gpn": "403496",
            "qty": 12,
            "diameter": 88,
            "ops": [
                (10, "Rezani", pila.id, 9, 3.6, 12.6, "planned", 2),
                (20, "Soustruzeni", ctx.id, 28, 57.6, 85.6, "planned", 2),
                (30, "Frezovani", cmx.id, 12, 22.0, 34.0, "waiting_release", None),
            ],
        },
        {
            "order_item_id": 3,
            "work_order_no": "VP260003",
            "gpn": "303276",
            "qty": 18,
            "diameter": 92,
            "ops": [
                (10, "Rezani", pila.id, 10, 6.3, 16.3, "planned", 3),
                (20, "Soustruzeni", ctx.id, 32, 96.0, 128.0, "waiting_release", None),
                (30, "Frezovani", cmx.id, 14, 30.0, 44.0, "waiting_release", None),
            ],
        },
    ]

    for row in demo_rows:
        for operation_no, operation_name, machine_id, setup_min, labor_min, total_min, status, queue_position in row["ops"]:
            db.add(
                PlanningOperation(
                    order_item_id=row["order_item_id"],
                    product_group_id=None,
                    work_order_no=row["work_order_no"],
                    gpn=row["gpn"],
                    operation_name=operation_name,
                    operation_no=operation_no,
                    machine_id=machine_id,
                    qty=row["qty"],
                    input_diameter_mm=row["diameter"],
                    setup_time_min=setup_min,
                    total_labor_time_min=labor_min,
                    total_operation_time_min=total_min,
                    expedition_date="2026-03-21",
                    planned_start=None,
                    planned_end=None,
                    actual_start=None,
                    actual_end=None,
                    qty_ok=None,
                    qty_nok=None,
                    released_at=None,
                    buffer_after_min=20,
                    queue_position=queue_position,
                    status=status,
                    planning_mode="auto",
                    is_locked=False,
                )
            )

    db.commit()
    return {"status": "ok", "rows_seeded": 9}
