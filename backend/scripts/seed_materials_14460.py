#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

import requests

API_URL = "http://127.0.0.1:8000/materials/"

DIAMETERS = [
    51.2,
    56.2,
    61.2,
    66.2,
    71.4,
    76.4,
    91.4,
    96.4,
    102,
    107,
    112,
    117,
    122,
    127,
    132,
    143,
    153,
    163,
    173,
    184,
    204,
    212,
    224,
    244,
    280,
    310,
    380,
]

EXCLUDED_DIAMETERS = {60.0, 80.0, 81.4, 86.4}

COMMON_VALUES = {
    "name": "1.4460",
    "material_type": "Nerez (duplex)",
    "form": "Tyč kruhová",
    "unit": "mm",
    "density": 7800,
    "price_per_kg": 135,
    "is_active": True,
}


def build_code(diameter: float) -> str:
    code_number = int(round(diameter * 10))
    return f"0720 {code_number:04d}"


def format_dimension(diameter: float) -> str:
    text = f"{diameter:g}".replace(".", ",")
    return f"{text} mm"


def read_existing_codes() -> set[str]:
    try:
        response = requests.get(API_URL, timeout=10)
        response.raise_for_status()
        rows: list[dict[str, Any]] = response.json()
    except Exception as exc:
        print(f"Nepodařilo se načíst existující materiály: {exc}")
        return set()
    return {str(row.get("code", "")).strip() for row in rows if row.get("code")}


def main() -> None:
    existing_codes = read_existing_codes()
    created: list[str] = []
    inserted_count = 0

    for diameter in DIAMETERS:
        if float(diameter) in EXCLUDED_DIAMETERS:
            continue

        code = build_code(diameter)
        if code in existing_codes:
            continue

        payload = {
            "code": code,
            "dimension": format_dimension(diameter),
            **COMMON_VALUES,
        }

        try:
            response = requests.post(API_URL, json=payload, timeout=10)
        except Exception as exc:
            print(f"Chyba při POST pro {code}: {exc}")
            continue

        if response.status_code in (200, 201):
            created.append(f"{code} | {COMMON_VALUES['name']} | {payload['dimension']}")
            inserted_count += 1
            existing_codes.add(code)
            continue

        if response.status_code == 409:
            existing_codes.add(code)
            continue

        # Fallback pro backendy, které vrací "exists" jiným kódem.
        try:
            body = response.json()
        except Exception:
            body = {}
        detail = str(body.get("detail", ""))
        if "exist" in detail.lower() or "already" in detail.lower():
            existing_codes.add(code)
            continue

        print(f"Neúspěšný insert pro {code}: HTTP {response.status_code} {response.text}")

    print("Vytvořené materiály:")
    if created:
        for row in created:
            print(f"- {row}")
    else:
        print("- Žádné nové materiály")
    print(f"Počet vložených řádků: {inserted_count}")


if __name__ == "__main__":
    main()
