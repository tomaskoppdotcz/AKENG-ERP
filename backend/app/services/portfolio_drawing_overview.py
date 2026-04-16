"""Výkres a revize z `portfolio_items` pro přehledy (jeden zdroj pravdy)."""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.portfolio import PortfolioItem


def drawing_number_revision_by_portfolio_id(
    db: Session, portfolio_item_ids: Iterable[int | None]
) -> dict[int, tuple[str | None, str | None]]:
    """Vrátí mapu portfolio_item_id → (drawing_number, drawing_revision); prázdné řetězce jako None."""
    ids = sorted({int(x) for x in portfolio_item_ids if x is not None})
    if not ids:
        return {}
    rows = db.scalars(select(PortfolioItem).where(PortfolioItem.id.in_(ids))).all()
    out: dict[int, tuple[str | None, str | None]] = {}
    for p in rows:
        pid = int(p.id)
        dn = getattr(p, "drawing_no", None)
        rv = getattr(p, "revision", None)
        dn_s = (str(dn).strip() if dn is not None else "") or None
        rv_s = (str(rv).strip() if rv is not None else "") or None
        out[pid] = (dn_s, rv_s)
    return out
