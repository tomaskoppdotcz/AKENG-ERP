"""Per-user persisted layout for overview tables (columns, sort, density)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserTableLayout(Base):
    __tablename__ = "user_table_layouts"
    __table_args__ = (UniqueConstraint("user_identifier", "page_key", name="uq_user_table_layout_page"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_identifier: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    page_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    layout_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
