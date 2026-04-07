"""Optional ERP user record (role stored for future auth; enforcement uses X-AKENG-Role header)."""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ErpUser(Base):
    __tablename__ = "erp_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="Obchod")
