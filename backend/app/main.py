import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import SessionLocal, engine
from app.core.logging_config import configure_app_console_logging
from app.models.base import Base

from app.api.master_data import run_master_data_startup, router as master_data_router
from app.api.master_libraries import ensure_master_libraries_sqlite_schema, router as master_libraries_router
from app.api.orders import ensure_orders_sqlite_schema, router as orders_router
from app.api.orders_overview import router as orders_overview_router
from app.api.order_detail import router as order_detail_router
from app.api.technology import ensure_technology_sqlite_schema, router as technology_router
from app.api.planning import (
    ensure_operation_machine_alternatives_schema,
    ensure_planning_runs_schema,
    ensure_planning_shift_schema,
    router as planning_router,
)
from app.api.planner_gantt import router as planner_gantt_router
from app.api.capacity_dashboard import router as capacity_dashboard_router
from app.api.auto_planner import router as auto_planner_router
from app.api.shopfloor_kiosk import router as shopfloor_kiosk_router
from app.api.production import router as production_router
from app.api.production_orders import router as production_orders_router
from app.api.cooperation import router as cooperation_router
from app.api.scan_lookup import router as scan_lookup_router
from app.api.seed import router as seed_router
from app.api.kiosk import router as kiosk_router
from app.api.import_orders import router as import_orders_router
from app.api.dev_tools import dev_tools_router
from app.api.generate_operations import router as generate_operations_router
from app.api.material_library import (
    ensure_material_library_sqlite_schema,
    normalize_nerez_material_groups,
    router as material_library_router,
    seed_material_groups,
)
from app.api.material_stock import ensure_material_stock_sqlite_schema, router as material_stock_router
from app.api.product_stock import ensure_product_stock_sqlite_schema, router as product_stock_router
from app.api.supplier_purchase_orders import (
    ensure_supplier_purchase_orders_sqlite_schema,
    router as supplier_purchase_orders_router,
)
from app.api.supplier_rfqs import ensure_supplier_rfqs_sqlite_schema, router as supplier_rfqs_router
from app.api.storage_location import ensure_storage_locations_sqlite_schema, router as storage_location_router
from app.api.portfolio import (
    ensure_portfolio_items_sqlite_schema,
    ensure_portfolio_technology_material_inputs_sqlite_schema,
    ensure_portfolio_technology_operation_library_fks,
    router as portfolio_router,
)
from app.api.customers import ensure_customers_sqlite_schema, router as customers_router
from app.api.ui_settings import router as ui_settings_router
from app.api.app_info import router as app_info_router
from app.api.table_layouts import router as table_layouts_router
from app.api.users_auth import (
    ensure_auth_sqlite_schema,
    router as users_auth_router,
    seed_roles_and_permissions,
)
from app.api.auth import bootstrap_admin_user, router as auth_router
from app.api.work_reports import router as work_reports_router
from app.services.work_report_code import ensure_work_report_code_schema
from app.services.operation_tracking_service import ensure_operation_events_sqlite_schema

from app.services.planning_operation_status import backfill_canonical_statuses

from app.models.planning import PlanningOperation, MachineCalendar, MachineSchedule, PlanningScheduleSegment  # noqa: F401
from app.models.kiosk import Employee, Kiosk, KioskActivityLog, KioskSession, OperationEvent
from app.models.orders import (
    CustomerOrder,
    Job,
    JobItem,
    JobItemCoverage,
    ProductionOrder,
    ProductionOrderOperation,
    ProductionOrderOperationLog,
)
from app.models.technology_library import TechnologyTemplate, TechnologyTemplateOperation
from app.models.portfolio import (
    PortfolioGroup,
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateOperation,
)
from app.models.master_data import EmployeeSubgroup, Machine  # noqa: F401 — metadata / create_all
from app.models.machine_shift_template import MachineShiftTemplate  # noqa: F401 — metadata / create_all
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.material_library import MaterialGroup, MaterialLibraryItem
from app.models.supplier_purchase_order import SupplierPurchaseOrder, SupplierPurchaseOrderItem
from app.models.supplier_rfq import ApprovedSupplier, SupplierRfq, SupplierRfqItem
from app.models.material_stock import (
    MaterialRemnantStockItem,
    MaterialReceiptUnit,
    MaterialStockItem,
    MaterialStockMovement,
    MaterialStockMovementAttachment,
    MaterialStockReservation,
)
from app.models.product_stock import ProductStockItem, ProductStockMovement, ProductStockReceipt
from app.models.fulfillment_decision_audit import FulfillmentDecisionAudit  # noqa: F401 — metadata / create_all
from app.models.restock_wip_reservation import RestockWipReservation  # noqa: F401 — metadata / create_all
from app.models.storage_location import StorageLocation
from app.models.erp_user import ErpUser  # noqa: F401 — metadata / create_all
from app.models.auth import (  # noqa: F401 — metadata / create_all
    AuthSession,
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from app.models.app_setting import AppSetting  # noqa: F401 — metadata / create_all
from app.models.user_table_layout import UserTableLayout  # noqa: F401 — metadata / create_all

configure_app_console_logging(logging.INFO)

app = FastAPI(title="AKENG ERP v1", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    configure_app_console_logging(logging.INFO)
    Base.metadata.create_all(bind=engine)
    backfill_canonical_statuses(engine)
    ensure_planning_shift_schema()
    ensure_operation_machine_alternatives_schema()
    ensure_planning_runs_schema()
    ensure_master_libraries_sqlite_schema(engine)
    ensure_technology_sqlite_schema(engine)
    ensure_orders_sqlite_schema(engine)
    ensure_customers_sqlite_schema(engine)
    ensure_material_library_sqlite_schema(engine)
    ensure_material_stock_sqlite_schema(engine)
    ensure_product_stock_sqlite_schema(engine)
    ensure_supplier_rfqs_sqlite_schema(engine)
    ensure_supplier_purchase_orders_sqlite_schema(engine)
    ensure_storage_locations_sqlite_schema(engine)
    ensure_portfolio_technology_operation_library_fks(engine)
    ensure_portfolio_technology_material_inputs_sqlite_schema(engine)
    ensure_portfolio_items_sqlite_schema(engine)
    ensure_auth_sqlite_schema(engine)
    ensure_work_report_code_schema(engine)
    ensure_operation_events_sqlite_schema(engine)
    db = SessionLocal()
    try:
        run_master_data_startup(db)
        seed_material_groups(db)
        normalize_nerez_material_groups(db)
        seed_roles_and_permissions(db)
        bootstrap_admin_user(db)
    finally:
        db.close()


app.include_router(master_data_router, prefix="/master-data", tags=["master-data"])
app.include_router(master_libraries_router, prefix="/libraries", tags=["libraries"])
app.include_router(material_library_router, prefix="/materials", tags=["materials"])
app.include_router(material_stock_router, prefix="/material-stock", tags=["material-stock"])
app.include_router(product_stock_router, prefix="/product-stock", tags=["product-stock"])
app.include_router(supplier_rfqs_router, tags=["supplier-rfqs"])
app.include_router(supplier_purchase_orders_router, tags=["supplier-purchase-orders"])
app.include_router(storage_location_router, prefix="/storage-locations", tags=["storage-locations"])
app.include_router(orders_router, prefix="/orders", tags=["orders"])
app.include_router(orders_overview_router, tags=["orders-overview"])
app.include_router(order_detail_router, tags=["order-detail"])
app.include_router(technology_router, prefix="/technology", tags=["technology"])
app.include_router(planning_router, prefix="/planning", tags=["planning"])
app.include_router(planner_gantt_router, prefix="/planning", tags=["planning-gantt"])
app.include_router(capacity_dashboard_router, prefix="/capacity-dashboard", tags=["capacity-dashboard"])
app.include_router(auto_planner_router, prefix="/auto-planner", tags=["auto-planner"])
app.include_router(shopfloor_kiosk_router, prefix="/shopfloor-kiosk", tags=["shopfloor-kiosk"])
app.include_router(production_router, prefix="/production", tags=["production"])
app.include_router(work_reports_router, prefix="/work-reports", tags=["work-reports"])
app.include_router(production_orders_router, prefix="/production-orders", tags=["production-orders"])
app.include_router(cooperation_router, prefix="/cooperation", tags=["cooperation"])
app.include_router(scan_lookup_router, prefix="/scan-lookup", tags=["scan-lookup"])
app.include_router(seed_router, prefix="/seed", tags=["seed"])
app.include_router(kiosk_router, prefix="/kiosk", tags=["kiosk"])
app.include_router(import_orders_router, prefix="/import", tags=["import"])
app.include_router(dev_tools_router, prefix="/dev", tags=["dev"])
app.include_router(generate_operations_router, prefix="/generate", tags=["generate"])
app.include_router(portfolio_router, prefix="/portfolio", tags=["portfolio"])
app.include_router(customers_router)
app.include_router(ui_settings_router, prefix="/ui", tags=["ui-settings"])
app.include_router(table_layouts_router, prefix="/ui", tags=["ui-table-layouts"])
app.include_router(users_auth_router)
app.include_router(auth_router)
app.include_router(app_info_router)


@app.get("/")
def root():
    return {"app": "AKENG ERP v1", "status": "ok"}
