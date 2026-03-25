import json
import httpx
from app.services.llm.base import LLMProvider


DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

_SYSTEM_PROMPT = "You are a skill extractor for a job platform. Extract only skills present in the provided taxonomy."

_SINGLE_USER_PROMPT = """Extract skills from this text. Return ONLY a JSON array of tags from the taxonomy below.

Taxonomy: {taxonomy}

Text:
{text}

Respond with ONLY a JSON array, e.g.: ["Python", "FastAPI"]"""

_BATCH_USER_PROMPT = """Extract skills for each job below. Return ONLY a JSON object mapping job_id to matched tags.

Taxonomy: {taxonomy}

Jobs:
{jobs}

Respond with ONLY a JSON object, e.g.: {{"abc123": ["Python"], "def456": ["React"]}}"""


def _strip_fences(raw: str) -> str:
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


class DeepSeekProvider(LLMProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def _call(self, user_prompt: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                DEEPSEEK_API_URL,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 2048,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"].strip()

    async def extract_tags(self, text: str, taxonomy: list[str]) -> list[str]:
        prompt = _SINGLE_USER_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
        raw = _strip_fences(await self._call(prompt))
        extracted = json.loads(raw)
        taxonomy_lower = {t.lower(): t for t in taxonomy}
        return [taxonomy_lower[e.lower()] for e in extracted if e.lower() in taxonomy_lower]

    async def extract_tags_batch(
        self, jobs: list[dict], taxonomy: list[str]
    ) -> dict[str, list[str]]:
        jobs_text = "\n\n".join(
            f"[job_id: {j['job_id']}]\n{j['description'][:3000]}" for j in jobs
        )
        prompt = _BATCH_USER_PROMPT.format(taxonomy=", ".join(taxonomy), jobs=jobs_text)
        raw = _strip_fences(await self._call(prompt))
        result = json.loads(raw)

        taxonomy_lower = {t.lower(): t for t in taxonomy}
        return {
            job_id: [taxonomy_lower[t.lower()] for t in tags if t.lower() in taxonomy_lower]
            for job_id, tags in result.items()
        }
