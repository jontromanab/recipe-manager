from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from environment variables.

    Swap to Postgres by setting DATABASE_URL, e.g.
    postgresql+psycopg://user:pass@host/recipes (and installing the driver).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/recipes.db"
    seed_on_startup: bool = True
    cors_origins: list[str] = ["http://localhost:5173"]
