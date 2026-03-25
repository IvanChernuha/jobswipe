from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_ANON_KEY: str
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@jobswipe.example.com"

    # LLM tag extraction
    LLM_PROVIDER: str = "gemini"   # "gemini" | "deepseek"
    GEMINI_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
