import os


def _env_bool(name: str, default: bool) -> bool:
    """Parse boolean env flag (true/1/yes/on → True; false/0/no/off → False)."""
    raw = os.getenv(name)
    if raw is None:
        return default
    v = raw.strip().lower()
    if v in ("1", "true", "yes", "on", "y", "t"):
        return True
    if v in ("0", "false", "no", "off", "n", "f"):
        return False
    return default


class Settings:
    app_name: str = "AKENG ERP"
    app_version: str = os.getenv("AKENG_APP_VERSION", "0.1.0")
    # DEV / TEST / PROD — čte se z env proměnné, default je DEV.
    app_environment: str = os.getenv("AKENG_APP_ENV", "DEV").upper()
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./akeng_erp_v1.db")

    # Přechodové pravidlo: pokud uživatel existuje v `erp_users`, ale nemá
    # `password_hash`, `/auth/login` pustí jakékoli heslo a first-login se tak
    # může provést bez předchozího admin resetu. Je to vhodné pro migraci z
    # ERP instance, kde hesla ještě neexistovala, ale je to bezpečnostní díra
    # — proto je to vypínatelné.
    #   AKENG_ALLOW_EMPTY_PASSWORD_LOGIN=true  (default, backward compat)
    #   AKENG_ALLOW_EMPTY_PASSWORD_LOGIN=false (ostrý režim — heslo vyžadováno)
    allow_empty_password_login: bool = _env_bool("AKENG_ALLOW_EMPTY_PASSWORD_LOGIN", True)


settings = Settings()
