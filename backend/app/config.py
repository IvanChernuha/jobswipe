from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_ANON_KEY: str
    # JWT secret used to VERIFY Supabase auth tokens on every request.
    # Must match the JWT_SECRET value in your self-hosted Supabase .env
    # (or the project JWT secret on Supabase Cloud). REQUIRED — the app
    # refuses to authenticate any request if this is empty.
    SUPABASE_JWT_SECRET: str
    # Direct Postgres URL for SQLModel async queries (refactor WP #571).
    # Format: postgresql+asyncpg://user:pass@host:5432/dbname
    # Empty during early refactor phases — app still runs via Supabase client.
    DATABASE_URL: str = ""
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@jobswipe.example.com"

    # LLM tag extraction
    LLM_PROVIDER: str = "gemini"   # "gemini" | "vertex" | "deepseek"
    GEMINI_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""
    # Vertex AI (for Google Cloud $300 credits)
    GOOGLE_CLOUD_PROJECT: str = ""
    GOOGLE_CLOUD_LOCATION: str = "us-central1"

    class Config:
        env_file = ".env"


settings = Settings()
