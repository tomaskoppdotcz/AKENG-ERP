"""Interní scan kódy (fáze 1) — stabilní identifikátor z DB id, ne obrázek čárového kódu."""


def portfolio_scan_code_for_id(row_id: int) -> str:
    return f"PF-{row_id:06d}"


def material_library_scan_code_for_id(row_id: int) -> str:
    return f"MAT-{row_id:06d}"


def material_stock_scan_code_for_id(row_id: int) -> str:
    return f"STK-{row_id:06d}"
