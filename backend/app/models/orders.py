from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String
from datetime import datetime
from sqlalchemy.orm import relationship
from app.models.base import Base


class CustomerOrder(Base):
    __tablename__ = "customer_orders"

    id = Column(Integer, primary_key=True)
    customer_po_no = Column(String, nullable=False)
    scan_code = Column(String(32), nullable=True)
    customer_name = Column(String, nullable=True)
    order_date = Column(Date, nullable=True)
    order_type = Column(String, nullable=False, default="customer")
    # active | cancelled (storno); NULL = legacy active
    workflow_status = Column(String(20), nullable=True)

    jobs = relationship("Job", back_populates="customer_order")


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    zak_code = Column(String, nullable=False)
    customer_order_id = Column(Integer, ForeignKey("customer_orders.id"))

    customer_order = relationship("CustomerOrder", back_populates="jobs")
    items = relationship("JobItem", back_populates="job")


class JobItem(Base):
    __tablename__ = "job_items"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("jobs.id"))

    line_no = Column(Integer, nullable=False)
    scan_code = Column(String(32), nullable=True)
    gpn = Column(String, nullable=False)
    qty = Column(Integer, nullable=False)
    due_date = Column(Date, nullable=True)
    workflow_status = Column(String(20), nullable=True)

    job = relationship("Job", back_populates="items")
    production_orders = relationship("ProductionOrder", back_populates="job_item")
    coverages = relationship("JobItemCoverage", back_populates="job_item")


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id = Column(Integer, primary_key=True)
    vp_code = Column(String, nullable=False)
    scan_code = Column(String(32), nullable=True)
    job_item_id = Column(Integer, ForeignKey("job_items.id"))
    customer_order_id = Column(Integer, ForeignKey("customer_orders.id"), nullable=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=True)
    portfolio_item_id = Column(Integer, ForeignKey("portfolio_items.id"), nullable=True)
    gpn = Column(String, nullable=True)
    description = Column(String, nullable=True)
    quantity = Column(Integer, nullable=True)
    logistic_mode = Column(String, nullable=True)
    source_type = Column(String, nullable=True)
    status = Column(String, nullable=True)
    # Operational VP aggregate: planned | bezi | hotovo (workflow_status = business / storno)
    workflow_status = Column(String(20), nullable=True)
    # Stock / rezervace: lze vydat (pokrytí požadavku volným skladem + rezervacemi)
    is_material_covered = Column(Boolean, nullable=False, default=False)
    # Skutečné vydání na výrobu: žádná aktivní rezervace planned/reserved — plánovač jen po tomto
    is_material_released_to_production = Column(Boolean, nullable=False, default=False)
    # Legacy: držíme v sync s is_material_released_to_production (API / starší klienti)
    is_material_ready = Column(Boolean, nullable=False, default=False)
    # Legacy historie; nový tok rezervace WIP již VP nepřesouvá
    restock_redirected_from_internal = Column(Boolean, nullable=False, default=False)
    # sklad_zakaznik VP čekající na příjem zboží z rezervovaného restock WIP (plánování blokováno)
    blocked_until_reserved_stock_receipt = Column(Boolean, nullable=False, default=False)
    priority = Column(Integer, nullable=False, default=50)
    # Application-level enforced via PriorityLabel enum from app.services.planning.enums
    priority_label = Column(String(16), nullable=True)
    priority_set_by_user_id = Column(Integer, nullable=True)
    priority_set_at = Column(DateTime, nullable=True)
    priority_reason = Column(String(500), nullable=True)
    # Predicted completion datetime computed by planner engine, max(planned_end) of all VP operations
    predicted_completion_at = Column(DateTime, nullable=True)
    # True if completion cannot be precisely predicted (e.g. pending cooperation without expected_return_date)
    predicted_completion_uncertain = Column(Boolean, nullable=False, default=False)
    # ok | tight | at_risk | overdue - computed from predicted_completion vs delivery_date - buffer
    deadline_risk_level = Column(String(16), nullable=True)
    # Negative = days of reserve before deadline, positive = days of delay. Working days, accounting for expedition buffer.
    predicted_delay_days = Column(Integer, nullable=True)
    # When predicted_completion was last computed by planner
    last_completion_calc_at = Column(DateTime, nullable=True)

    job_item = relationship("JobItem", back_populates="production_orders")


class JobItemCoverage(Base):
    __tablename__ = "job_item_coverages"

    id = Column(Integer, primary_key=True)
    job_item_id = Column(Integer, ForeignKey("job_items.id"), nullable=False)
    coverage_type = Column(String, nullable=False)  # stock / wip / new_production
    qty = Column(Integer, nullable=False)
    source_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    source_stock_receipt_id = Column(Integer, ForeignKey("product_stock_receipts.id"), nullable=True)
    consuming_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    note = Column(String, nullable=True)

    job_item = relationship("JobItem", back_populates="coverages")


class ProductionOrderOperationLog(Base):
    __tablename__ = "production_order_operation_logs"

    id = Column(Integer, primary_key=True)
    production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False)
    operation_no = Column(Integer, nullable=False)
    event_type = Column(String(20), nullable=False)  # start / report
    ok_qty = Column(Integer, nullable=True)
    nok_qty = Column(Integer, nullable=True)
    reported_minutes = Column(Integer, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ProductionOrderOperation(Base):
    __tablename__ = "production_order_operations"

    id = Column(Integer, primary_key=True)
    production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False)
    operation_no = Column(Integer, nullable=False)
    operation_name = Column(String, nullable=False)
    workplace_name = Column(String, nullable=True)
    workplace_library_item_id = Column(Integer, ForeignKey("workplace_library_items.id"), nullable=True)
    scan_code = Column(String(32), nullable=True)
    # Rezani/Pila: auto cutting instructions (see vp_pila_operation_notes).
    note = Column(String(2000), nullable=True)


class ProductIssue(Base):
    __tablename__ = "product_issues"

    id = Column(Integer, primary_key=True)
    product_stock_item_id = Column(Integer, ForeignKey("product_stock_items.id"), nullable=False, index=True)
    job_item_id = Column(Integer, ForeignKey("job_items.id"), nullable=True, index=True)
    customer_order_id = Column(Integer, ForeignKey("customer_orders.id"), nullable=True, index=True)
    qty = Column(Integer, nullable=False)
    note = Column(String, nullable=True)
    issued_at = Column(DateTime, nullable=False, default=datetime.utcnow)
