#!/usr/bin/env python3
"""CLI helper: run the same demo E2E seed as POST /seed/demo-e2e (requires backend deps + DB)."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal  # noqa: E402
from app.services.demo_e2e_scenario import run_demo_e2e_seed  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        result = run_demo_e2e_seed(db)
        print(result)
    finally:
        db.close()


if __name__ == "__main__":
    main()
