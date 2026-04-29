from app.services.pdf_generator import _operation_workplace_print_label, _print_operation_note


def test_print_operation_note_uses_vp_note_for_rezani_operation():
    assert (
        _print_operation_note(
            {
                "operation_name": "Řezání",
                "note": "Řezat D107 (0720) 2x L=82",
                "vp_operation_note": "Řezat:\nATEST    Rozměr    Počet\nA        313 mm    3x",
            }
        )
        == "Řezat:\nATEST    Rozměr    Počet\nA        313 mm    3x"
    )


def test_print_operation_note_uses_vp_note_for_rezani_without_diacritics():
    assert (
        _print_operation_note(
            {
                "operation_name": "Rezani / pila",
                "note": "TP poznámka",
                "vp_operation_note": "VP řezací instrukce",
            }
        )
        == "VP řezací instrukce"
    )


def test_print_operation_note_keeps_tp_note_for_non_cutting_operation():
    assert (
        _print_operation_note(
            {
                "operation_name": "Svařování",
                "note": "TP pracovní postup",
                "vp_operation_note": "VP poznámka, která sem nepatří",
            }
        )
        == "TP pracovní postup"
    )


def test_print_operation_note_does_not_fall_back_to_tp_note_when_cutting_vp_note_is_empty():
    assert (
        _print_operation_note(
            {
                "operation_name": "Pila",
                "note": "TP pracovní postup",
                "vp_operation_note": "  ",
            }
        )
        == "—"
    )


def test_operation_workplace_print_label_prefers_machine_code():
    assert (
        _operation_workplace_print_label(
            {
                "workplace_name": "CNC soustruh",
                "machine_code": "CLX450",
                "machine_name": "DMG MORI CLX 450",
            }
        )
        == "CLX450"
    )


def test_operation_workplace_print_label_falls_back_to_machine_name_then_workplace():
    assert (
        _operation_workplace_print_label(
            {
                "workplace_name": "CNC soustruh",
                "machine_code": "  ",
                "machine_name": "DMG MORI CLX 450",
            }
        )
        == "DMG MORI CLX 450"
    )
    assert _operation_workplace_print_label({"workplace_name": "Pila"}) == "Pila"
