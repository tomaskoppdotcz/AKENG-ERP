from app.services.material_requirements_query import _cutting_required_qty


def test_cutting_required_qty_includes_batches_clamp_and_kerf():
    assert (
        _cutting_required_qty(
            requested_piece_count=10,
            delka_na_kus_mm=100.0,
            vyrabeno_po=3,
            na_upnuti_mm=10.0,
            prorez_mm=3.0,
        )
        == 1052.0
    )


def test_cutting_required_qty_omits_remainder_cut_when_exact_batch():
    assert (
        _cutting_required_qty(
            requested_piece_count=6,
            delka_na_kus_mm=100.0,
            vyrabeno_po=3,
            na_upnuti_mm=10.0,
            prorez_mm=3.0,
        )
        == 626.0
    )
