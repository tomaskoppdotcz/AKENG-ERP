from app.api.production_orders import _planning_operation_header, _production_order_financials
from app.models.master_data import Machine
from app.models.planning import PlanningOperation


def _machine(machine_id: int, name: str) -> Machine:
    return Machine(id=machine_id, machine_code=name, name=name, machine_type="cnc")


def _op(op_id: int, operation_no: int, name: str, machine_id: int, status: str) -> PlanningOperation:
    return PlanningOperation(
        id=op_id,
        work_order_no="VP-HEADER-1",
        gpn="GPN-1",
        operation_name=name,
        operation_no=operation_no,
        machine_id=machine_id,
        qty=1,
        status=status,
    )


def test_production_order_detail_header_uses_last_done_current_and_next_from_planning_ops():
    machines = {
        1: _machine(1, "PILA"),
        2: _machine(2, "HAAS ST40"),
        3: _machine(3, "KONTROLA"),
        4: _machine(4, "SKLAD"),
    }
    header = _planning_operation_header(
        [
            _op(1, 10, "Řezání", 1, "hotovo"),
            _op(2, 20, "Soustružení", 2, "hotovo"),
            _op(3, 30, "Kontrola", 3, "planned"),
            _op(4, 40, "Příjem sklad", 4, "planned"),
        ],
        machines,
    )

    assert header == {
        "completed_operation": "20. Soustružení — HAAS ST40",
        "current_operation": "30. Kontrola — KONTROLA",
        "next_operation": "40. Příjem sklad — SKLAD",
    }


def test_production_order_detail_header_uses_first_machine_before_any_operation_is_done():
    header = _planning_operation_header(
        [
            _op(1, 10, "Řezání", 1, "ready"),
            _op(2, 20, "Soustružení", 2, "planned"),
        ],
        {1: _machine(1, "PILA"), 2: _machine(2, "HAAS ST40")},
    )

    assert header["completed_operation"] is None
    assert header["current_operation"] == "10. Řezání — PILA"
    assert header["next_operation"] == "20. Soustružení — HAAS ST40"


def test_production_order_detail_header_marks_done_when_all_planning_ops_are_done():
    header = _planning_operation_header(
        [
            _op(1, 10, "Řezání", 1, "hotovo"),
            _op(2, 20, "Soustružení", 2, "hotovo"),
        ],
        {1: _machine(1, "PILA"), 2: _machine(2, "HAAS ST40")},
    )

    assert header["completed_operation"] == "20. Soustružení — HAAS ST40"
    assert header["current_operation"] == "Hotovo"
    assert header["next_operation"] is None


def test_production_order_financials_calculate_revenue_profit_and_margin():
    financials = _production_order_financials(
        selling_price_per_piece=280.6,
        quantity=100,
        total_cost=15000,
    )

    assert financials["revenue"] == 28060
    assert financials["profit"] == 13060
    assert round(financials["margin_percent"], 1) == 46.5


def test_production_order_financials_return_no_margin_without_revenue():
    financials = _production_order_financials(
        selling_price_per_piece=None,
        quantity=100,
        total_cost=15000,
    )

    assert financials["revenue"] == 0
    assert financials["profit"] == -15000
    assert financials["margin_percent"] is None
