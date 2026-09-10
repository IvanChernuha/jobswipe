"""Photo moderation on upload.

Modes (IMAGE_MODERATION): "auto" -> "gemini" when GEMINI_API_KEY is set, else
"block"; or force "gemini" | "block" | "off".

"gemini" sends the image to Gemini 2.5 Flash-Lite with a strict classifier
prompt and rejects sexual content, graphic violence, hate symbols, or any
sexualised minor. Cost: a few hundred to ~2.5k input tokens per image at
$0.10/1M — fractions of a cent — and callers also charge one LLM quota unit,
so one account cannot run up the bill. Fails CLOSED: if the check itself
errors, the upload is rejected with 503 rather than stored unscanned.
"""
import base64
import logging

import httpx
import json_repair
from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

GEMINI_LITE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"

_PROMPT = (
    "You are a strict content-safety classifier for a professional job platform's "
    "profile photos and company logos. Reply with ONLY a JSON object: "
    '{"safe": true|false, "category": "ok"|"sexual"|"violence"|"hate"|"minor"|"other"}. '
    "Unsafe = any nudity or sexual content, graphic violence or gore, hate symbols, "
    "or any sexualised depiction of a minor. Ordinary portraits, logos, illustrations "
    "and landscapes are safe."
)


def resolve_mode() -> str:
    mode = (settings.IMAGE_MODERATION or "auto").strip().lower()
    if mode == "auto":
        return "gemini" if settings.GEMINI_API_KEY else "block"
    return mode


async def check_image(content: bytes, mime_type: str) -> None:
    """Raise HTTPException if the image must not be stored."""
    mode = resolve_mode()
    if mode == "off":
        return
    if mode == "block":
        raise HTTPException(503, "Photo uploads are temporarily disabled")
    if mode != "gemini":
        raise HTTPException(503, f"Unknown IMAGE_MODERATION mode {mode!r}")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GEMINI_LITE_URL,
                headers={"x-goog-api-key": settings.GEMINI_API_KEY},
                json={
                    "contents": [{"parts": [
                        {"text": _PROMPT},
                        {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(content).decode()}},
                    ]}],
                    "generationConfig": {"temperature": 0.0, "maxOutputTokens": 64},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates") or []
        # Gemini's own safety filter refusing the request is itself a verdict.
        if not candidates or candidates[0].get("finishReason") == "SAFETY":
            safe, category = False, "provider-safety-filter"
        else:
            raw = candidates[0]["content"]["parts"][0]["text"]
            verdict = json_repair.loads(raw)
            safe = bool(verdict.get("safe", False))
            category = str(verdict.get("category", "other"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("image moderation check failed (%s) — rejecting upload (fail closed)", e)
        raise HTTPException(503, "Could not verify the image right now. Please try again.")

    if not safe:
        logger.warning("image rejected by moderation: category=%s", category)
        raise HTTPException(400, "This image isn't allowed on JobSwipe.")
