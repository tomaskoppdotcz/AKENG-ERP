#!/usr/bin/env python3
"""
Deprecated: this script previously deleted portfolio and other master data.

Use instead:
  python backend/scripts/cleanup_operational_data.py
  python backend/scripts/cleanup_operational_data.py --dry-run
"""

from __future__ import annotations

import sys


def main() -> None:
    print(
        "This script is deprecated and no longer deletes data.\n"
        "Use:  python backend/scripts/cleanup_operational_data.py [--dry-run]\n"
        "That script preserves portfolio, templates, and material library.",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
