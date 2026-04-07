from typing import Annotated

from fastapi import Depends, Header

from app.core.rbac import assert_can, normalize_role


def get_effective_role(
    x_akeng_role: Annotated[str | None, Header(alias="X-AKENG-Role")] = None,
) -> str | None:
    return normalize_role(x_akeng_role)


def require_action(action: str):
    def _dep(role: str | None = Depends(get_effective_role)) -> None:
        assert_can(role, action)

    return _dep
