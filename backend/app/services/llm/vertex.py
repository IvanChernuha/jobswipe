"""Vertex AI Gemini provider — uses Google Cloud $300 credits."""
import json
import logging
import httpx
import json_repair
from app.services.llm.gemini import (
    GeminiProvider,
    _strip_fences,
    _JOB_PROFILE_PROMPT,
    _CV_PROFILE_PROMPT,
    _SINGLE_PROMPT,
    _BATCH_PROMPT,
)

logger = logging.getLogger(__name__)


class VertexGeminiProvider(GeminiProvider):
    """
    Same as GeminiProvider but authenticates via Google Cloud service account
    and hits the Vertex AI endpoint (bills against $300 Cloud credits).

    Requires:
      - GOOGLE_CLOUD_PROJECT env var
      - GOOGLE_CLOUD_LOCATION env var (default: us-central1)
      - GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
    """

    def __init__(self, project: str, location: str = "us-central1", model: str = "gemini-2.5-flash"):
        self.project = project
        self.location = location
        self.model = model
        self._base_url = (
            f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{location}/publishers/google/models/{model}:generateContent"
        )

    def _get_access_token(self) -> str:
        """Get OAuth2 token from Application Default Credentials."""
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
        import google.auth

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        credentials.refresh(Request())
        return credentials.token

    async def _call(self, prompt: str) -> str:
        token = self._get_access_token()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                self._base_url,
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.0, "maxOutputTokens": 8192},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates")
        if not candidates:
            logger.error("Vertex AI returned no candidates. promptFeedback=%s", data.get("promptFeedback"))
            raise ValueError("Vertex AI returned no candidates (safety filter or empty response)")
        return candidates[0]["content"]["parts"][0]["text"].strip()
