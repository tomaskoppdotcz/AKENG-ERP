"""Interní scan kódy (fáze 1) — stabilní identifikátor z DB id, ne obrázek čárového kódu."""


def portfolio_scan_code_for_id(row_id: int) -> str:
    return f"PF-{row_id:06d}"


def material_library_scan_code_for_id(row_id: int) -> str:
    return f"MAT-{row_id:06d}"


def material_stock_scan_code_for_id(row_id: int) -> str:
    return f"STK-{row_id:06d}"


def material_stock_movement_scan_code_for_id(row_id: int) -> str:
    """Jednoznačný kód skladového pohybu materiálu (výdej / příjem / korekce)."""
    return f"MVM-{row_id:06d}"


def product_stock_scan_code_for_id(row_id: int) -> str:
    return f"STKP-{row_id:06d}"


def customer_order_scan_code_for_id(row_id: int) -> str:
    return f"ORD-{row_id:06d}"


def order_item_scan_code_for_id(row_id: int) -> str:
    return f"ORI-{row_id:06d}"


def production_order_scan_code_for_id(row_id: int) -> str:
    return f"WO-{row_id:06d}"


def production_order_operation_scan_code_for_id(row_id: int) -> str:
    return f"WOO-{row_id:06d}"
