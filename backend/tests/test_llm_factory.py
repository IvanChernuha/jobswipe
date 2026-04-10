"""Tests for the LLM provider factory — especially empty-key edge cases."""
import pytest
from unittest.mock import patch, MagicMock


def _make_settings(**overrides):
    """Return a mock settings object."""
    defaults = {
        "LLM_PROVIDER": "gemini",
        "GEMINI_API_KEY": "real-key",
        "DEEPSEEK_API_KEY": "",
    }
    defaults.update(overrides)
    m = MagicMock()
    for k, v in defaults.items():
        setattr(m, k, v)
    return m


class TestGetLlmProvider:

    def test_gemini_provider_returned_when_configured(self):
        from app.services.llm.gemini import GeminiProvider

        settings = _make_settings(LLM_PROVIDER="gemini", GEMINI_API_KEY="abc")
        with patch("app.services.llm.factory.settings", settings):
            from app.services.llm.factory import get_llm_provider
            provider = get_llm_provider()
        assert isinstance(provider, GeminiProvider)
        assert provider.api_key == "abc"

    def test_deepseek_provider_returned_when_configured(self):
        from app.services.llm.deepseek import DeepSeekProvider

        settings = _make_settings(LLM_PROVIDER="deepseek", DEEPSEEK_API_KEY="xyz")
        with patch("app.services.llm.factory.settings", settings):
            from app.services.llm.factory import get_llm_provider
            provider = get_llm_provider()
        assert isinstance(provider, DeepSeekProvider)
        assert provider.api_key == "xyz"

    def test_unknown_provider_raises_value_error(self):
        settings = _make_settings(LLM_PROVIDER="openai")
        with patch("app.services.llm.factory.settings", settings):
            from app.services.llm.factory import get_llm_provider
            with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
                get_llm_provider()

    def test_provider_name_is_case_insensitive(self):
        """'Gemini' and 'GEMINI' should both work."""
        from app.services.llm.gemini import GeminiProvider

        for variant in ("Gemini", "GEMINI", "GeMiNi"):
            settings = _make_settings(LLM_PROVIDER=variant, GEMINI_API_KEY="k")
            with patch("app.services.llm.factory.settings", settings):
                from app.services.llm.factory import get_llm_provider
                provider = get_llm_provider()
            assert isinstance(provider, GeminiProvider)

    def test_empty_string_gemini_key_raises(self):
        """Factory validates empty API keys — rejects with ValueError."""
        settings = _make_settings(LLM_PROVIDER="gemini", GEMINI_API_KEY="")
        with patch("app.services.llm.factory.settings", settings):
            from app.services.llm.factory import get_llm_provider
            with pytest.raises(ValueError, match="GEMINI_API_KEY"):
                get_llm_provider()

    def test_empty_string_deepseek_key_raises(self):
        """Factory validates empty API keys — rejects with ValueError."""
        settings = _make_settings(LLM_PROVIDER="deepseek", DEEPSEEK_API_KEY="")
        with patch("app.services.llm.factory.settings", settings):
            from app.services.llm.factory import get_llm_provider
            with pytest.raises(ValueError, match="DEEPSEEK_API_KEY"):
                get_llm_provider()
