from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import SessionLocal, engine
from app.models.base import Base

from app.api.master_data import router as master_data_router
from app.api.master_libraries import ensure_master_libraries_sqlite_schema, router as master_libraries_router
from app.api.orders import ensure_orders_sqlite_schema, router as orders_router
from app.api.orders_overview import router as orders_overview_router
from app.api.order_detail import router as order_detail_router
from app.api.technology import router as technology_router
from app.api.planning import router as planning_router
from app.api.planner_gantt import router as planner_gantt_router
from app.api.capacity_dashboard import router as capacity_dashboard_router
from app.api.auto_planner import router as auto_planner_router
from app.api.shopfloor_kiosk import router as shopfloor_kiosk_router
from app.api.production import router as production_router
from app.api.production_orders import router as production_orders_router
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
from app.api.storage_location import ensure_storage_locations_sqlite_schema, router as storage_location_router
from app.api.portfolio import (
    ensure_portfolio_items_sqlite_schema,
    ensure_portfolio_technology_material_inputs_sqlite_schema,
    ensure_portfolio_technology_operation_library_fks,
    router as portfolio_router,
)
from app.api.customers import ensure_customers_sqlite_schema, router as customers_router

from app.models.planning import PlanningOperation, MachineCalendar, MachineSchedule
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
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.material_library import MaterialGroup, MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement, MaterialStockReservation
from app.models.product_stock import ProductStockItem, ProductStockMovement, ProductStockReceipt
from app.models.storage_location import StorageLocation
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
    Base.metadata.create_all(bind=engine)
    ensure_master_libraries_sqlite_schema(engine)
    ensure_orders_sqlite_schema(engine)
    ensure_customers_sqlite_schema(engine)
    ensure_material_library_sqlite_schema(engine)
    ensure_material_stock_sqlite_schema(engine)
    ensure_product_stock_sqlite_schema(engine)
    ensure_storage_locations_sqlite_schema(engine)
    ensure_portfolio_technology_operation_library_fks(engine)
    ensure_portfolio_technology_material_inputs_sqlite_schema(engine)
    ensure_portfolio_items_sqlite_schema(engine)
    db = SessionLocal()
    try:
        seed_material_groups(db)
        normalize_nerez_material_groups(db)
    finally:
        db.close()


app.include_router(master_data_router, prefix="/master-data", tags=["master-data"])
app.include_router(master_libraries_router, prefix="/libraries", tags=["libraries"])
app.include_router(material_library_router, prefix="/materials", tags=["materials"])
app.include_router(material_stock_router, prefix="/material-stock", tags=["material-stock"])
app.include_router(product_stock_router, prefix="/product-stock", tags=["product-stock"])
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
app.include_router(production_orders_router, prefix="/production-orders", tags=["production-orders"])
app.include_router(scan_lookup_router, prefix="/scan-lookup", tags=["scan-lookup"])
app.include_router(seed_router, prefix="/seed", tags=["seed"])
app.include_router(kiosk_router, prefix="/kiosk", tags=["kiosk"])
app.include_router(import_orders_router, prefix="/import", tags=["import"])
app.include_router(dev_tools_router, prefix="/dev", tags=["dev"])
app.include_router(generate_operations_router, prefix="/generate", tags=["generate"])
app.include_router(portfolio_router, prefix="/portfolio", tags=["portfolio"])
app.include_router(customers_router)


@app.get("/")
def root():
    return {"app": "AKENG ERP v1", "status": "ok"}
