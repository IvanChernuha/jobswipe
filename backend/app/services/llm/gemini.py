import json
import logging
import httpx
import json_repair
from app.services.llm.base import LLMProvider, CVProfile, JobProfile

logger = logging.getLogger(__name__)


GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

_SINGLE_PROMPT = """You are a skill extractor for a job platform.

Given the following text (a CV or job description), extract ONLY the skills, technologies, tools, and soft skills that are explicitly mentioned or clearly implied.

Return ONLY a JSON array of strings from the provided taxonomy list. Do not invent tags. Do not return tags not in the list.

Taxonomy (valid tags):
{taxonomy}

Text to analyze:
{text}

Respond with ONLY a JSON array, e.g.: ["Python", "FastAPI", "PostgreSQL"]"""

_CV_PROFILE_PROMPT = """You are a CV parser for a job platform.

Extract the following from the CV text below and return ONLY a JSON object:
- "name": full name of the person (string or null)
- "location": city/country (string or null)
- "experience_years": total years of work experience as an integer (null if unclear)
- "bio": a 2-3 sentence professional summary of the person (string or null)
- "tags": array of matched skills/tools from the taxonomy ONLY (no invented tags)

Taxonomy (valid tags):
{taxonomy}

CV text:
{text}

Respond with ONLY a JSON object, e.g.:
{{"name": "John Smith", "location": "London, UK", "experience_years": 5, "bio": "Backend developer...", "tags": ["Python", "FastAPI"]}}"""

_JOB_PROFILE_PROMPT = """You are a job posting parser for a job platform.

The job description may be in any language. Extract the data and respond ONLY in English.

Return ONLY a valid JSON object with these fields IN THIS EXACT ORDER:
1. "title": job title in English (string or null)
2. "location": city/country in English (string or null)
3. "remote": true if remote or hybrid, false otherwise (boolean)
4. "salary_min": minimum annual salary in USD as integer, null if not mentioned
5. "salary_max": maximum annual salary in USD as integer, null if not mentioned
6. "required_tags": skills the candidate MUST have — from taxonomy ONLY (array of strings)
7. "preferred_tags": skills that are preferred — from taxonomy ONLY (array of strings)
8. "nice_tags": nice-to-have skills — from taxonomy ONLY (array of strings)
9. "description": 1-2 sentence summary in English, keep it SHORT (string or null)
10. "min_experience_years": minimum years of experience required as integer (null if not mentioned)

IMPORTANT: Tags MUST come from the taxonomy list below. Keep description under 50 words.

Taxonomy (valid tags):
{taxonomy}

Job description:
{text}

Respond with ONLY a JSON object, e.g.:
{{"title": "Senior Python Developer", "location": "New York, NY", "remote": true, "salary_min": 90000, "salary_max": 130000, "required_tags": ["Python", "PostgreSQL"], "preferred_tags": ["FastAPI"], "nice_tags": ["Docker"], "description": "Backend role building payment APIs.", "min_experience_years": 5}}"""

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
    raw = raw.strip()
    # Extract JSON object or array — handles extra prose around the JSON
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = raw.find(start_char)
        end = raw.rfind(end_char)
        if start != -1 and end != -1 and end > start:
            return raw[start:end + 1]
    return raw


class GeminiProvider(LLMProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def _call(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_API_URL,
                headers={"x-goog-api-key": self.api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.0, "maxOutputTokens": 8192},
                },
            )
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                # Sanitize: HTTPStatusError includes request.url which previously
                # contained ?key=... in the query string. Now the key is in a
                # header so it's not in the URL, but we still log safely.
                logger.error("Gemini API error %s: %s", resp.status_code, resp.text[:500])
                raise
            data = resp.json()

        candidates = data.get("candidates")
        if not candidates:
            logger.error("Gemini returned no candidates. promptFeedback=%s", data.get("promptFeedback"))
            raise ValueError("Gemini returned no candidates (safety filter or empty response)")
        return candidates[0]["content"]["parts"][0]["text"].strip()

    async def extract_job_profile(self, text: str, taxonomy: list[str]) -> JobProfile:
        prompt = _JOB_PROFILE_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
        raw_response = await self._call(prompt)
        raw = _strip_fences(raw_response)
        try:
            data = json_repair.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("Gemini JSON parse error: %s\nRaw response: %.500s", e, raw)
            raise
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
        prompt = _SINGLE_PROMPT.format(taxonomy=", ".join(taxonomy), text=text[:8000])
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
        prompt = _BATCH_PROMPT.format(taxonomy=", ".join(taxonomy), jobs=jobs_text)
        raw = _strip_fences(await self._call(prompt))
        result = json_repair.loads(raw)

        taxonomy_lower = {t.lower(): t for t in taxonomy}
        return {
            job_id: [taxonomy_lower[t.lower()] for t in tags if t.lower() in taxonomy_lower]
            for job_id, tags in result.items()
        }
