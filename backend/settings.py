from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/reisekosten.db"
    upload_dir: str = "./data/uploads"
    openai_api_key: str = ""
    jwt_secret_key: str = ""
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://188.245.191.188:8010",
    ]
    api_host: str = "0.0.0.0"
    api_port: int = 8011


settings = Settings()
