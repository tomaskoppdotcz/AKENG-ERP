"""PBKDF2 hash for employee kiosk PIN (no plain storage)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

_ITERATIONS = 390_000
_ALGO = "pbkdf2_sha256"


def hash_pin(plain: str) -> str:
    """Return storable secret: pbkdf2_sha256$iter$salt_b64$hash_b64"""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, _ITERATIONS, dklen=32)
    return f"{_ALGO}${_ITERATIONS}${base64.b64encode(salt).decode('ascii')}${base64.b64encode(dk).decode('ascii')}"


def verify_pin(plain: str, stored: str | None) -> bool:
    if not stored or not plain:
        return False
    parts = str(stored).split("$")
    if len(parts) != 4 or parts[0] != _ALGO:
        return False
    try:
        iterations = int(parts[1])
        salt = base64.b64decode(parts[2].encode("ascii"))
        expected = base64.b64decode(parts[3].encode("ascii"))
    except Exception:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, iterations, dklen=len(expected))
    return hmac.compare_digest(dk, expected)


def constant_time_fail() -> None:
    """Burn comparable time when user missing to reduce timing oracle."""
    hash_pin(secrets.token_hex(8))
