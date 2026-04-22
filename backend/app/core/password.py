"""
AKENG ERP — password hashing (PBKDF2-HMAC-SHA256, stdlib only).

Formát uloženého hashe:
    pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>

Bez externích závislostí (žádný `passlib` / `bcrypt`) — jednoduchá první
verze vhodná pro on-prem pilot. Konstantní čas porovnání přes
`secrets.compare_digest`.

Parametry jsou schválně uložené v hashi (iterations, salt), takže je možné
je v budoucnu navýšit bez rozbití existujících hesel.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

_ALGO = "pbkdf2_sha256"
_DEFAULT_ITERATIONS = 200_000
_SALT_BYTES = 16
_HASH_BYTES = 32


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def hash_password(plain: str, *, iterations: int = _DEFAULT_ITERATIONS) -> str:
    """Spočítá hash hesla. Vrací řetězec vhodný pro uložení do DB."""
    if not isinstance(plain, str) or plain == "":
        raise ValueError("Heslo nesmí být prázdné.")
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, iterations, dklen=_HASH_BYTES)
    return f"{_ALGO}${iterations}${_b64e(salt)}${_b64e(dk)}"


def verify_password(plain: str, stored: str | None) -> bool:
    """Ověří heslo proti uloženému hashi. Prázdný / null hash → False."""
    if not stored or not isinstance(stored, str):
        return False
    try:
        algo, iter_s, salt_b64, hash_b64 = stored.split("$", 3)
    except ValueError:
        return False
    if algo != _ALGO:
        return False
    try:
        iterations = int(iter_s)
        salt = _b64d(salt_b64)
        expected = _b64d(hash_b64)
    except (ValueError, TypeError):
        return False
    if iterations < 1 or len(expected) == 0:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, iterations, dklen=len(expected))
    return hmac.compare_digest(dk, expected)
