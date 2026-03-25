from sqlalchemy import Column, Integer, String, Date, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base


class CustomerOrder(Base):
    __tablename__ = "customer_orders"

    id = Column(Integer, primary_key=True)
    customer_po_no = Column(String, nullable=False)
    customer_name = Column(String, nullable=True)
    order_date = Column(Date, nullable=True)
    order_type = Column(String, nullable=False, default="customer")

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
    gpn = Column(String, nullable=False)
    qty = Column(Integer, nullable=False)
    due_date = Column(Date, nullable=True)

    job = relationship("Job", back_populates="items")
    production_orders = relationship("ProductionOrder", back_populates="job_item")


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id = Column(Integer, primary_key=True)
    vp_code = Column(String, nullable=False)
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

    job_item = relationship("JobItem", back_populates="production_orders")
