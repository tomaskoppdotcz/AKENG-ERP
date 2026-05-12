#!/usr/bin/env python3
"""Jednorázový bootstrap: vytvoří nebo resetuje účet admin (heslo dle konstant níže)."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.password import hash_password  # noqa: E402
from app.models.erp_user import ErpUser  # noqa: E402

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"
ADMIN_ROLE = "Administrativa"
ADMIN_DISPLAY_NAME = "Administrátor"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("bootstrap_admin_user")


def main() -> None:
    db = SessionLocal()
    try:
        user = db.scalar(select(ErpUser).where(ErpUser.username == ADMIN_USERNAME))
        if user is None:
            user = ErpUser(
                username=ADMIN_USERNAME,
                role=ADMIN_ROLE,
                display_name=ADMIN_DISPLAY_NAME,
                is_active=True,
                password_hash=hash_password(ADMIN_PASSWORD),
            )
            db.add(user)
            action = "created"
            log.info("Vytvořen uživatel %r.", ADMIN_USERNAME)
        else:
            user.password_hash = hash_password(ADMIN_PASSWORD)
            action = "reset"
            log.info("Reset hesla pro uživatele %r (id=%s).", ADMIN_USERNAME, user.id)

        db.commit()
        db.refresh(user)
        print(action)
        print(user.username)
        print(user.role)
    except Exception:
        db.rollback()
        log.exception("Bootstrap selhal.")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
