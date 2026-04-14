"""Shared normalization for USB card readers when OS keyboard layout is Czech (QWERTZ).

Public API: ``normalize_czech_keyboard_reader_numeric`` — use for chip UID, scan codes,
and kiosk credential strings before compare or DB write.
"""

from __future__ import annotations

import unicodedata

# Unicode escapes only — avoids source encoding issues with Czech letters.
# CZ unshifted digit row: 1→+ 2→ě 3→š 4→č 5→ř 6→ž 7→ý 8→á 9→í 0→é
_CZ_CHAR_TO_DIGIT: dict[str, str] = {
    "+": "1",
    "\u011b": "2",
    "\u0161": "3",
    "\u010d": "4",
    "\u0159": "5",
    "\u017e": "6",
    "\u00fd": "7",
    "\u00e1": "8",
    "\u00ed": "9",
    "\u00e9": "0",
}


def normalize_czech_keyboard_reader_numeric(value: str) -> str:
    """Map CZ keyboard digit keys to ASCII digits; leave ``0``–``9`` and other characters unchanged.

    NFC is applied first so NFD-composed accents still match the map.
    """
    if not value:
        return value
    s = unicodedata.normalize("NFC", value)
    out: list[str] = []
    for ch in s:
        if ch.isdigit():
            out.append(ch)
            continue
        mapped = _CZ_CHAR_TO_DIGIT.get(ch)
        if mapped is None:
            mapped = _CZ_CHAR_TO_DIGIT.get(ch.casefold())
        if mapped:
            out.append(mapped)
        else:
            out.append(ch)
    return "".join(out)
