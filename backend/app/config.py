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
    # Rate-limit counters (slowapi). Separate Redis logical DB from the Celery
    # broker/result backend so keys never collide. Shared across all API pods.
    RATELIMIT_STORAGE_URL: str = "redis://redis:6379/2"
    # Comma-separated allowed CORS origins for the browser app. Default "*"
    # preserves current behaviour; set to your real domain(s) in production.
    CORS_ORIGINS: str = "*"

    # --- Abuse / cost controls ---
    # Daily LLM extraction budget per account: 1 unit per CV, job description,
    # or job file sent to the LLM (see services/llm_quota.py).
    LLM_DAILY_UNITS_PER_ACCOUNT: int = 300
    # Per-account login lockout: after this many failures within the window,
    # /auth/login returns 429 for the rest of the window (services/login_guard.py).
    LOGIN_MAX_FAILURES: int = 10
    LOGIN_LOCKOUT_SECONDS: int = 900
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@jobswipe.example.com"

    # --- Observability (Sentry) ---
    # DSN of the Sentry project that receives error events. Empty = Sentry
    # disabled (errors still logged locally). Set via the k8s Secret in prod.
    SENTRY_DSN: str = ""
    # Environment tag on every Sentry event ("production" / "staging" /
    # "development"). Set to "production" in the prod ConfigMap.
    ENVIRONMENT: str = "development"
    # Fraction of requests traced for performance (0.0-1.0). 0.0 = tracing off.
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0
    # Optional release identifier (e.g. git SHA) shown on Sentry events.
    RELEASE: str = ""

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
