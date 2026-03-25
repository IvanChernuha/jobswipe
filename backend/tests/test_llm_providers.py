"""Unit tests for GeminiProvider and DeepSeekProvider — httpx is fully mocked."""
import json
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch


TAXONOMY = ["Python", "FastAPI", "PostgreSQL", "Docker", "Kubernetes"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status_code: int, body: dict):
    """Return a mock that behaves like an httpx.Response."""
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = body
    if status_code >= 400:
        import httpx
        mock.raise_for_status.side_effect = httpx.HTTPStatusError(
            "error", request=MagicMock(), response=mock
        )
    else:
        mock.raise_for_status.return_value = None
    return mock


def _gemini_body(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def _deepseek_body(text: str) -> dict:
    return {"choices": [{"message": {"content": text}}]}


# ---------------------------------------------------------------------------
# GeminiProvider
# ---------------------------------------------------------------------------

class TestGeminiProvider:

    @pytest.mark.asyncio
    async def test_happy_path_returns_filtered_tags(self):
        from app.services.llm.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        raw_json = json.dumps(["Python", "FastAPI", "NotInTaxonomy"])
        resp = _mock_response(200, _gemini_body(raw_json))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            result = await provider.extract_tags("I know Python and FastAPI", TAXONOMY)

        assert result == ["Python", "FastAPI"]

    @pytest.mark.asyncio
    async def test_strips_markdown_code_fence(self):
        """Response wrapped in ```json ... ``` must be parsed correctly."""
        from app.services.llm.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        fenced = "```json\n[\"Python\", \"Docker\"]\n```"
        resp = _mock_response(200, _gemini_body(fenced))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            result = await provider.extract_tags("text", TAXONOMY)

        assert "Python" in result
        assert "Docker" in result

    @pytest.mark.asyncio
    async def test_case_insensitive_matching(self):
        """Tags returned in wrong case (e.g. 'python') must still match."""
        from app.services.llm.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        raw_json = json.dumps(["python", "FASTAPI"])
        resp = _mock_response(200, _gemini_body(raw_json))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            result = await provider.extract_tags("text", TAXONOMY)

        # Returns the canonical casing from taxonomy
        assert "Python" in result
        assert "FastAPI" in result

    @pytest.mark.asyncio
    async def test_http_error_propagates(self):
        """A 4xx/5xx response must raise (not swallow) the error."""
        from app.services.llm.gemini import GeminiProvider
        import httpx

        provider = GeminiProvider(api_key="bad-key")
        resp = _mock_response(401, {"error": "bad key"})

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            with pytest.raises(httpx.HTTPStatusError):
                await provider.extract_tags("text", TAXONOMY)

    @pytest.mark.asyncio
    async def test_invalid_json_raises(self):
        """Malformed JSON in the response must raise json.JSONDecodeError."""
        from app.services.llm.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        resp = _mock_response(200, _gemini_body("not-json-at-all"))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            with pytest.raises(Exception):  # json.JSONDecodeError or ValueError
                await provider.extract_tags("text", TAXONOMY)

    @pytest.mark.asyncio
    async def test_empty_taxonomy_returns_empty_list(self):
        """When taxonomy is empty, result must always be []."""
        from app.services.llm.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        resp = _mock_response(200, _gemini_body("[]"))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            result = await provider.extract_tags("text", [])

        assert result == []

    @pytest.mark.asyncio
    async def test_missing_candidates_key_raises(self):
        """
        BUG: if Gemini returns a safety-blocked response with no 'candidates'
        key, data["candidates"][0] raises KeyError — provider should not
        silently pass.
        """
        from app.services.llm.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key")
        # Gemini sometimes returns {"promptFeedback": {...}} with no candidates
        body = {"promptFeedback": {"blockReason": "SAFETY"}}
        resp = _mock_response(200, body)

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            # Expect a KeyError — documents the crash so it can be fixed
            with pytest.raises(KeyError):
                await provider.extract_tags("text", TAXONOMY)


# ---------------------------------------------------------------------------
# DeepSeekProvider
# ---------------------------------------------------------------------------

class TestDeepSeekProvider:

    @pytest.mark.asyncio
    async def test_happy_path_returns_filtered_tags(self):
        from app.services.llm.deepseek import DeepSeekProvider

        provider = DeepSeekProvider(api_key="test-key")
        raw_json = json.dumps(["FastAPI", "PostgreSQL", "Nonexistent"])
        resp = _mock_response(200, _deepseek_body(raw_json))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            result = await provider.extract_tags("description", TAXONOMY)

        assert result == ["FastAPI", "PostgreSQL"]

    @pytest.mark.asyncio
    async def test_strips_markdown_code_fence(self):
        from app.services.llm.deepseek import DeepSeekProvider

        provider = DeepSeekProvider(api_key="test-key")
        fenced = "```json\n[\"Docker\"]\n```"
        resp = _mock_response(200, _deepseek_body(fenced))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            result = await provider.extract_tags("text", TAXONOMY)

        assert "Docker" in result

    @pytest.mark.asyncio
    async def test_sends_bearer_auth_header(self):
        """Authorization header must be set correctly."""
        from app.services.llm.deepseek import DeepSeekProvider

        provider = DeepSeekProvider(api_key="my-secret-key")
        resp = _mock_response(200, _deepseek_body("[]"))

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            await provider.extract_tags("text", TAXONOMY)

        call_kwargs = mock_client.post.call_args
        headers = call_kwargs.kwargs.get("headers", {})
        assert headers.get("Authorization") == "Bearer my-secret-key"

    @pytest.mark.asyncio
    async def test_http_error_propagates(self):
        from app.services.llm.deepseek import DeepSeekProvider
        import httpx

        provider = DeepSeekProvider(api_key="bad-key")
        resp = _mock_response(429, {"error": "rate limit"})

        with patch("httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=resp)
            mock_cls.return_value = mock_client

            with pytest.raises(httpx.HTTPStatusError):
                await provider.extract_tags("text", TAXONOMY)
