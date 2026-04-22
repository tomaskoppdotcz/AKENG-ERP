"""ERP uživatel (knihovna uživatelů + příprava pro skutečný login).

Sloupec `role` je ponechán pro zpětnou kompatibilitu (default role, použita
v legacy `X-AKENG-Role` headerech). Skutečné přiřazení rolí je v tabulce
`erp_user_roles` (viz `app.models.auth`).
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ErpUser(Base):
    __tablename__ = "erp_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="Obchod")
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    chip_code: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    note: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=_utc_now_naive
    )
