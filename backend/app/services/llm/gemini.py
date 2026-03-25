import json
import httpx
from app.services.llm.base import LLMProvider


GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

_SINGLE_PROMPT = """You are a skill extractor for a job platform.

Given the following text (a CV or job description), extract ONLY the skills, technologies, tools, and soft skills that are explicitly mentioned or clearly implied.

Return ONLY a JSON array of strings from the provided taxonomy list. Do not invent tags. Do not return tags not in the list.

Taxonomy (valid tags):
{taxonomy}

Text to analyze:
{text}

Respond with ONLY a JSON array, e.g.: ["Python", "FastAPI", "PostgreSQL"]"""

_BATCH_PROMPT = """You are a skill extractor for a job platform.

Extract skills/technologies/tools from each job description below. Use ONLY tags from the taxonomy.

Return ONLY a JSON object mapping each job_id to its matched tags. No extra text.

Taxonomy:
{taxonomy}

Jobs:
{jobs}

Respond with ONLY a JSON object, e.g.:
{{"abc123": ["Python", "FastAPI"], "def456": ["React", "TypeScript"]}}"""


def _strip_fences(raw: str) -> str:
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


class GeminiProvider(LLMProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def _call(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{GEMINI_API_URL}?key={self.api_key}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates")
        if not candidates:
            raise ValueError(f"Gemini returned no candidates: {data}")
        return candidates[0]["content"]["parts"][0]["text"].strip()

    async def extract_tags(self, text: str, taxonomy: list[str]) -> list[str]:
        prompt = _SINGLE_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
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
        prompt = _BATCH_PROMPT.format(taxonomy=", ".join(taxonomy), jobs=jobs_text)
        raw = _strip_fences(await self._call(prompt))
        result = json.loads(raw)

        taxonomy_lower = {t.lower(): t for t in taxonomy}
        return {
            job_id: [taxonomy_lower[t.lower()] for t in tags if t.lower() in taxonomy_lower]
            for job_id, tags in result.items()
        }
