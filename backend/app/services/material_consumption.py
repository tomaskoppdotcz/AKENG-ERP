"""Shared material consumption: additive kerf per piece, same unit as consumption."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def total_material_consumption(
    consumption_per_piece: float | None,
    kerf_per_piece: float | None,
    quantity: float | int,
) -> float:
    """(consumption_per_piece + kerf_per_piece) * quantity; kerf is non-negative."""
    c = float(consumption_per_piece or 0.0)
    k = max(float(kerf_per_piece or 0.0), 0.0)
    q = float(quantity or 0.0)
    return max((c + k) * q, 0.0)


def log_material_consumption_debug(
    *,
    context: str,
    consumption_per_piece: float,
    kerf_per_piece: float,
    quantity: float,
    total: float,
    vp_code: str | None = None,
    material_library_item_id: int | None = None,
    template_material_id: int | None = None,
) -> None:
    logger.info(
        "[material_consumption] %s | vp=%s material_library_item_id=%s template_material_id=%s "
        "consumption_per_piece=%s kerf_per_piece=%s quantity=%s total=%s "
        "(formula: (consumption_per_piece + kerf_per_piece) * quantity)",
        context,
        vp_code,
        material_library_item_id,
        template_material_id,
        consumption_per_piece,
        kerf_per_piece,
        quantity,
        total,
    )
