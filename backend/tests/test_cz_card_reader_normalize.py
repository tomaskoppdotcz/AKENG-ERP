"""Tests: CZ keyboard card-reader normalization."""

from __future__ import annotations

from app.services.cz_card_reader_normalize import normalize_czech_keyboard_reader_numeric

# Literal UID0005735257 as if typed on Czech QWERTZ (unshifted digit row).
_CZ_UID_0005735257 = (
    "\u00e9\u00e9\u00e9"  # 000
    "\u0159\u00fd\u0161\u0159\u011b\u0159\u00fd"  # 5735257
)


def test_cz_keystrokes_to_digits():
    assert normalize_czech_keyboard_reader_numeric(_CZ_UID_0005735257) == "0005735257"


def test_numeric_unchanged():
    assert normalize_czech_keyboard_reader_numeric("0005735257") == "0005735257"


def test_nfd_composed_accent():
    # e + combining acute → é → 0
    nfd = "e\u0301e\u0301e\u0301"
    assert normalize_czech_keyboard_reader_numeric(nfd) == "000"


def test_plus_to_one():
    assert normalize_czech_keyboard_reader_numeric("+") == "1"


def test_mixed_employee_code_unchanged_letters():
    assert normalize_czech_keyboard_reader_numeric("E001") == "E001"


if __name__ == "__main__":
    test_cz_keystrokes_to_digits()
    test_numeric_unchanged()
    test_nfd_composed_accent()
    test_plus_to_one()
    test_mixed_employee_code_unchanged_letters()
    print("cz_card_reader_normalize: all tests passed")
