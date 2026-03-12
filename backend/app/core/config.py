import os

class Settings:
    app_name: str = 'AKENG ERP v1'
    database_url: str = os.getenv('DATABASE_URL', 'sqlite:///./akeng_erp_v1.db')

settings = Settings()
