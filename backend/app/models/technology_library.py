from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base


class TechnologyTemplate(Base):
    __tablename__ = "technology_templates"

    id = Column(Integer, primary_key=True)

    gpn = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=True)
    revision = Column(String, nullable=True)

    material = Column(String, nullable=True)
    product_group = Column(String, nullable=True)

    is_active = Column(Boolean, nullable=False, default=True)

    operations = relationship(
        "TechnologyTemplateOperation",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="TechnologyTemplateOperation.operation_no.asc()",
    )


class TechnologyTemplateOperation(Base):
    __tablename__ = "technology_template_operations"

    id = Column(Integer, primary_key=True)

    template_id = Column(Integer, ForeignKey("technology_templates.id"), nullable=False)

    operation_no = Column(Integer, nullable=False)
    operation_name = Column(String, nullable=False)

    workplace_library_item_id = Column(Integer, ForeignKey("workplace_library_items.id"), nullable=True, index=True)
    machine_code = Column(String, nullable=False)
    machine_name = Column(String, nullable=True)

    setup_time_min = Column(Float, nullable=False, default=0)
    labor_time_per_piece_min = Column(Float, nullable=False, default=0)
    buffer_after_min = Column(Integer, nullable=False, default=20)

    is_cooperation = Column(Boolean, nullable=False, default=False)
    default_cooperation_status = Column(String(30), nullable=True)
    cooperation_category = Column(String(80), nullable=True)
    preferred_supplier_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    cooperation_note = Column(String, nullable=True)

    note = Column(String, nullable=True)

    template = relationship("TechnologyTemplate", back_populates="operations")
