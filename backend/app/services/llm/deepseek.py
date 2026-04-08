import json
import httpx
import json_repair
from app.services.llm.base import LLMProvider, CVProfile, JobProfile


DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

_SYSTEM_PROMPT = "You are a CV parser for a job platform. Extract only skills present in the provided taxonomy."

_JOB_PROFILE_PROMPT = """Parse this job description. The text may be in any language — respond in English only.

Return ONLY a JSON object with fields IN THIS ORDER:
1. "title": job title in English (string or null)
2. "location": city/country in English (string or null)
3. "remote": true if remote/hybrid (boolean)
4. "salary_min": min annual salary USD integer (null if not mentioned)
5. "salary_max": max annual salary USD integer (null if not mentioned)
6. "required_tags": must-have skills from taxonomy ONLY
7. "preferred_tags": preferred skills from taxonomy ONLY
8. "nice_tags": nice-to-have skills from taxonomy ONLY
9. "description": 1-2 sentence summary, under 50 words (string or null)
10. "min_experience_years": minimum years of experience required as integer (null if not mentioned)

Tags MUST come from the taxonomy list. Keep description SHORT.

Taxonomy: {taxonomy}

Job description:
{text}

Respond with ONLY a JSON object."""

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
    raw = raw.strip()
    # Extract JSON object or array — handles extra prose around the JSON
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = raw.find(start_char)
        end = raw.rfind(end_char)
        if start != -1 and end != -1 and end > start:
            return raw[start:end + 1]
    return raw


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

    async def extract_job_profile(self, text: str, taxonomy: list[str]) -> JobProfile:
        prompt = _JOB_PROFILE_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
        raw = _strip_fences(await self._call(prompt))
        data = json_repair.loads(raw)
        taxonomy_lower = {t.lower(): t for t in taxonomy}

        def match(tags: list) -> list[str]:
            return [taxonomy_lower[t.lower()] for t in (tags or []) if t.lower() in taxonomy_lower]

        return JobProfile(
            title=data.get("title") or None,
            description=data.get("description") or None,
            location=data.get("location") or None,
            remote=bool(data.get("remote", False)),
            salary_min=int(data["salary_min"]) if data.get("salary_min") else None,
            salary_max=int(data["salary_max"]) if data.get("salary_max") else None,
            required_tags=match(data.get("required_tags", [])),
            preferred_tags=match(data.get("preferred_tags", [])),
            nice_tags=match(data.get("nice_tags", [])),
            min_experience_years=int(data["min_experience_years"]) if data.get("min_experience_years") else None,
        )

    async def extract_cv_profile(self, text: str, taxonomy: list[str]) -> CVProfile:
        prompt = _CV_PROFILE_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
        raw = _strip_fences(await self._call(prompt))
        data = json_repair.loads(raw)
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
        extracted = json_repair.loads(raw)
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
        result = json_repair.loads(raw)

        taxonomy_lower = {t.lower(): t for t in taxonomy}
        return {
            job_id: [taxonomy_lower[t.lower()] for t in tags if t.lower() in taxonomy_lower]
            for job_id, tags in result.items()
        }
