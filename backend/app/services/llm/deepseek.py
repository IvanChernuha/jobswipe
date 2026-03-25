import json
import httpx
from app.services.llm.base import LLMProvider, CVProfile


DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

_SYSTEM_PROMPT = "You are a CV parser for a job platform. Extract only skills present in the provided taxonomy."

_CV_PROFILE_PROMPT = """Extract profile data from this CV. Return ONLY a JSON object with:
- "name": full name (string or null)
- "location": city/country (string or null)
- "experience_years": total years of experience as integer (null if unclear)
- "bio": 2-3 sentence professional summary (string or null)
- "tags": matched skills from taxonomy ONLY

Taxonomy: {taxonomy}

CV:
{text}

Respond with ONLY a JSON object."""

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

    async def extract_cv_profile(self, text: str, taxonomy: list[str]) -> CVProfile:
        prompt = _CV_PROFILE_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
        raw = _strip_fences(await self._call(prompt))
        data = json.loads(raw)
        taxonomy_lower = {t.lower(): t for t in taxonomy}
        tags = [taxonomy_lower[t.lower()] for t in (data.get("tags") or []) if t.lower() in taxonomy_lower]
        exp = data.get("experience_years")
        return CVProfile(
            tags=tags,
            name=data.get("name") or None,
            location=data.get("location") or None,
            experience_years=int(exp) if exp is not None else None,
            bio=data.get("bio") or None,
        )

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
