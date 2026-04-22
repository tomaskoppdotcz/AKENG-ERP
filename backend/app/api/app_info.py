"""Veřejný endpoint pro login obrazovku — verze a prostředí aplikace."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(tags=["app-info"])


class AppInfoOut(BaseModel):
    name: str
    version: str
    environment: str  # DEV / TEST / PROD
    subtitle: str


@router.get("/app-info", response_model=AppInfoOut)
def get_app_info() -> AppInfoOut:
    env = (settings.app_environment or "DEV").upper()
    if env not in {"DEV", "TEST", "PROD"}:
        env = "DEV"
    return AppInfoOut(
        name=settings.app_name,
        version=settings.app_version,
        environment=env,
        subtitle="Řízení výroby, plánování, sklad a provoz",
    )
