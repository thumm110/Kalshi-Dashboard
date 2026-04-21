from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    kalshi_api_key_id: str = ""
    kalshi_private_key_path: str = "./kalshi_private_key.pem"
    kalshi_api_base: str = "https://api.elections.kalshi.com/trade-api/v2"
    dashboard_password: str = "change-me"
    snapshot_interval_seconds: int = 30
    db_path: str = "./kalshi_dashboard.db"
    cors_origins: str = "http://localhost:5173"


settings = Settings()
