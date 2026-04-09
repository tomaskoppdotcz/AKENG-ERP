"""Šablony směn — kanonicky vázané na pracoviště (knihovna); machine_id je plánovací kotva pro machine_calendar."""

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, UniqueConstraint

from app.models.base import Base


class MachineShiftTemplate(Base):
    """
    Jedna šablona na (machine_id, weekday); workplace_library_item_id určuje vlastníka z pohledu KM (Pracoviště).
    weekday: 0 = pondělí … 6 = neděle (Python date.weekday()).
    """

    __tablename__ = "machine_shift_templates"
    __table_args__ = (UniqueConstraint("machine_id", "weekday", name="uq_machine_shift_template_machine_weekday"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False, index=True)
    workplace_library_item_id = Column(Integer, ForeignKey("workplace_library_items.id"), nullable=True, index=True)
    weekday = Column(Integer, nullable=False)
    start_minutes = Column(Integer, nullable=False)
    end_minutes = Column(Integer, nullable=False)
    label = Column(String(80), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
