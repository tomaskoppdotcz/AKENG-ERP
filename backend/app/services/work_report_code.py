"""Sequential public codes for work reports (WR-000001)."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.work_report import WorkReport, WorkReportCodeSequence

WORK_REPORT_CODE_PREFIX = "WR-"
_CODE_RE = re.compile(r"^WR-(\d+)$", re.I)


def format_work_report_code(seq: int) -> str:
    return f"{WORK_REPORT_CODE_PREFIX}{int(seq):06d}"


def _parse_code_num(code: str | None) -> int | None:
    if not code or not str(code).strip():
        return None
    m = _CODE_RE.match(str(code).strip())
    if not m:
        return None
    return int(m.group(1))


def _dialect_allows_add_column(dialect: str) -> bool:
    return dialect in ("sqlite", "postgresql")


def _max_parsed_work_report_code_n(db: Session) -> int:
    rows = list(
        db.scalars(
            select(WorkReport.code).where(WorkReport.code.is_not(None), WorkReport.code != "")
        ).all()
    )
    max_n = 0
    for c in rows:
        n = _parse_code_num(c)
        if n is not None and n > max_n:
            max_n = n
    return max_n


def _sync_sequence_counter(db: Session) -> None:
    """Ensure single-row counter is at least max(code)+1."""
    next_val = _max_parsed_work_report_code_n(db) + 1
    row = db.get(WorkReportCodeSequence, 1)
    if row is None:
        db.add(WorkReportCodeSequence(id=1, next_val=next_val))
    elif row.next_val < next_val:
        row.next_val = next_val
    db.flush()


def ensure_work_report_code_schema(engine: Engine) -> None:
    """Add work_reports.code, work_report_code_seq, backfill, and unique index on code."""
    try:
        insp: Any = sa_inspect(engine)
    except Exception:
        return
    tables = set(insp.get_table_names() or [])
    if "work_reports" not in tables:
        return
    dialect = engine.dialect.name
    if not _dialect_allows_add_column(dialect):
        return

    wr_cols = {c["name"] for c in insp.get_columns("work_reports")}
    if "code" not in wr_cols:
        with engine.begin() as conn:
            if dialect == "sqlite":
                conn.execute(text("ALTER TABLE work_reports ADD COLUMN code VARCHAR(32)"))
            else:
                conn.execute(text("ALTER TABLE work_reports ADD COLUMN code VARCHAR(32) NULL"))

    insp2: Any = sa_inspect(engine)
    if "work_report_code_seq" not in set(insp2.get_table_names() or []):
        WorkReportCodeSequence.__table__.create(bind=engine, checkfirst=True)

    db = SessionLocal()
    try:
        need = list(
            db.scalars(
                select(WorkReport)
                .where((WorkReport.code.is_(None)) | (WorkReport.code == ""))
                .order_by(WorkReport.id.asc())
            ).all()
        )
        m = _max_parsed_work_report_code_n(db)
        for r in need:
            m += 1
            r.code = format_work_report_code(m)
        db.flush()
        _sync_sequence_counter(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    insp3: Any = sa_inspect(engine)
    has_code_uq = any(
        bool(ix.get("unique")) and list(ix.get("column_names") or []) == ["code"]
        for ix in (insp3.get_indexes("work_reports") or [])
    )
    if not has_code_uq:
        with engine.begin() as conn:
            if dialect == "sqlite":
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX uq_work_reports_code "
                        "ON work_reports (code) WHERE code IS NOT NULL"
                    )
                )
            else:
                conn.execute(text("CREATE UNIQUE INDEX uq_work_reports_code ON work_reports (code)"))


def allocate_next_work_report_code(db: Session) -> str:
    """Return next unique WR-###### (same transaction as insert)."""
    row = db.get(WorkReportCodeSequence, 1)
    if row is None:
        _sync_sequence_counter(db)
        row = db.get(WorkReportCodeSequence, 1)
    if row is None:
        db.add(WorkReportCodeSequence(id=1, next_val=1))
        db.flush()
        row = db.get(WorkReportCodeSequence, 1)
    n = int(row.next_val)  # type: ignore[union-attr]
    row.next_val = n + 1
    db.flush()
    return format_work_report_code(n)
