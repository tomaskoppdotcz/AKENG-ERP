from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.material_library import MaterialLibraryItem
    from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
    from app.models.product_stock import ProductStockItem


class PortfolioGroup(Base):
    __tablename__ = "portfolio_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    items: Mapped[list["PortfolioItem"]] = relationship("PortfolioItem", back_populates="group")


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True, nullable=False)
    portfolio_group_id: Mapped[int | None] = mapped_column(ForeignKey("portfolio_groups.id"), index=True, nullable=True)
    gpn: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    scan_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    drawing_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revision: Mapped[str | None] = mapped_column(String(40), nullable=True)
    material_default: Mapped[str | None] = mapped_column(String(255), nullable=True)
    logistic_mode: Mapped[str] = mapped_column(String(40), default="vyroba_zakaznik", nullable=False)
    sale_price_per_piece: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("portfolio_technology_templates.id"),
        index=True,
        nullable=True,
    )

    customer: Mapped["Customer"] = relationship("Customer")
    group: Mapped["PortfolioGroup | None"] = relationship("PortfolioGroup", back_populates="items")
    technology_templates: Mapped[list["PortfolioTechnologyTemplate"]] = relationship(
        "PortfolioTechnologyTemplate",
        back_populates="portfolio_item",
        foreign_keys="PortfolioTechnologyTemplate.portfolio_item_id",
        cascade="all, delete-orphan",
    )
    active_template: Mapped["PortfolioTechnologyTemplate | None"] = relationship(
        "PortfolioTechnologyTemplate",
        foreign_keys=[active_template_id],
        post_update=True,
    )
    product_stock_items: Mapped[list["ProductStockItem"]] = relationship(
        "ProductStockItem",
        back_populates="portfolio_item",
        cascade="all, delete-orphan",
    )


class PortfolioTechnologyTemplate(Base):
    __tablename__ = "portfolio_technology_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    portfolio_item_id: Mapped[int] = mapped_column(ForeignKey("portfolio_items.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(20), default="A", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    portfolio_item: Mapped["PortfolioItem"] = relationship(
        "PortfolioItem",
        back_populates="technology_templates",
        foreign_keys=[portfolio_item_id],
    )
    operations: Mapped[list["PortfolioTechnologyTemplateOperation"]] = relationship(
        "PortfolioTechnologyTemplateOperation",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="PortfolioTechnologyTemplateOperation.operation_no.asc()",
    )
    materials: Mapped[list["PortfolioTechnologyTemplateMaterial"]] = relationship(
        "PortfolioTechnologyTemplateMaterial",
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="PortfolioTechnologyTemplateMaterial.id.asc()",
    )


class PortfolioTechnologyTemplateOperation(Base):
    __tablename__ = "portfolio_technology_template_operations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("portfolio_technology_templates.id"), index=True, nullable=False)
    operation_no: Mapped[int] = mapped_column(Integer, nullable=False)
    operation_name: Mapped[str] = mapped_column(String(255), nullable=False)
    workplace: Mapped[str | None] = mapped_column(String(120), nullable=True)
    operation_library_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("operation_library_items.id"), index=True, nullable=True
    )
    workplace_library_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("workplace_library_items.id"), index=True, nullable=True
    )
    setup_min: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    run_min_per_piece: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    control_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    outsourcing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    template: Mapped["PortfolioTechnologyTemplate"] = relationship("PortfolioTechnologyTemplate", back_populates="operations")
    operation_library_item: Mapped["OperationLibraryItem | None"] = relationship(
        "OperationLibraryItem",
        foreign_keys=[operation_library_item_id],
    )
    workplace_library_item: Mapped["WorkplaceLibraryItem | None"] = relationship(
        "WorkplaceLibraryItem",
        foreign_keys=[workplace_library_item_id],
    )


class PortfolioTechnologyTemplateMaterial(Base):
    __tablename__ = "portfolio_technology_template_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("portfolio_technology_templates.id"), index=True, nullable=False)
    # Obecný vstup TP: defaultně materiál (legacy), nově i výrobek ze skladu.
    input_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    material_library_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_library_items.id"),
        index=True,
        nullable=True,
    )
    portfolio_item_id: Mapped[int | None] = mapped_column(ForeignKey("portfolio_items.id"), index=True, nullable=True)
    consumption_per_piece: Mapped[float | None] = mapped_column(Float, nullable=True)
    consumption_unit: Mapped[str | None] = mapped_column(String(120), nullable=True)
    scrap_allowance: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Řezání / polotovar (doplňující parametry; spotřeba/ks a prořez zůstávají v consumption_ / scrap_).
    na_upnuti_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    vyrabet_max_po_ks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    povolit_deleni_polotovaru: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    template: Mapped["PortfolioTechnologyTemplate"] = relationship(
        "PortfolioTechnologyTemplate",
        back_populates="materials",
    )
    material_library_item: Mapped["MaterialLibraryItem | None"] = relationship("MaterialLibraryItem")
    portfolio_item: Mapped["PortfolioItem | None"] = relationship("PortfolioItem")

