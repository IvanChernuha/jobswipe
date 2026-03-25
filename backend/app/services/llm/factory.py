from app.services.llm.base import LLMProvider
from app.config import settings


def get_llm_provider() -> LLMProvider:
    """Return the configured LLM provider based on LLM_PROVIDER env var."""
    provider = settings.LLM_PROVIDER.lower()

    if provider == "gemini":
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set in environment")
        from app.services.llm.gemini import GeminiProvider
        return GeminiProvider(api_key=settings.GEMINI_API_KEY)

    if provider == "deepseek":
        if not settings.DEEPSEEK_API_KEY:
            raise ValueError("DEEPSEEK_API_KEY is not set in environment")
        from app.services.llm.deepseek import DeepSeekProvider
        return DeepSeekProvider(api_key=settings.DEEPSEEK_API_KEY)

    raise ValueError(f"Unknown LLM_PROVIDER: '{provider}'. Use 'gemini' or 'deepseek'.")
