from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    kalshi_api_key_id: str = ""
    kalshi_private_key_path: str = "./kalshi_private_key.pem"
    kalshi_api_base: str = "https://api.elections.kalshi.com/trade-api/v2"
    dashboard_password: str = "change-me"
    snapshot_interval_seconds: int = 30
    db_path: str = "./kalshi_dashboard.db"
    cors_origins: str = "*"
    weather_bot_db_path: str = "/home/thumm/Desktop/predict-and-profit-v2/weather-bot/predict_and_profit.db"
    econ_bot_db_path: str = "/home/thumm/Desktop/predict-and-profit-v2/econ-bot/kalshi_econ_trading.db"


settings = Settings()
