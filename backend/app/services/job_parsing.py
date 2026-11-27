"""Turn the AI's reading of a job posting into form data with real tag ids."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables.tag import Tag
from app.services.llm.base import JobProfile


async def load_taxonomy(session: AsyncSession) -> dict[str, str]:
    """Every skill name the AI may use, mapped to its tag id."""
    result = await session.execute(select(Tag.id, Tag.name))
    return {row.name: str(row.id) for row in result.all()}


def profile_to_form(profile: JobProfile, taxonomy: dict[str, str]) -> dict:
    """The job form fields, with skills split by requirement level. Names the
    AI made up (not in the taxonomy) are dropped; case is ignored."""
    by_lower = {name.lower(): name for name in taxonomy}

    def known(names: list[str]) -> list[str]:
        return [by_lower[n.lower()] for n in names or [] if n.lower() in by_lower]

    required, preferred, nice = known(profile.required_tags), known(profile.preferred_tags), known(profile.nice_tags)
    return {
        "title": profile.title,
        "description": profile.description,
        "location": profile.location,
        "remote": profile.remote,
        "salary_min": profile.salary_min,
        "salary_max": profile.salary_max,
        "min_experience_years": profile.min_experience_years,
        "required_tag_ids": [taxonomy[n] for n in required],
        "preferred_tag_ids": [taxonomy[n] for n in preferred],
        "tag_ids": [taxonomy[n] for n in nice],
        "required_tags": required,
        "preferred_tags": preferred,
        "nice_tags": nice,
    }


MIN_TEXT = 20  # characters of real text; less is an empty or scanned file

NO_TEXT = ("We couldn't find any text in this file. If it's a scan or a photo, "
           "upload the original document (PDF, Word or text) instead.")


class NotAJobPost(Exception):
    """The text isn't a job post (a CV, or something else): the wrong file or text."""

    def __init__(self, kind: str):
        self.kind = kind
        if kind == "cv":
            message = "This looks like a CV, not a job post. Check that you picked the right file or text."
        else:
            message = "This doesn't look like a job post. Check that you picked the right file or text."
        super().__init__(message)


def check_is_job_post(profile: JobProfile) -> None:
    if (getattr(profile, "kind", "job_post") or "job_post") != "job_post":
        raise NotAJobPost(profile.kind)


async def parse_job_text(session: AsyncSession, provider, text: str) -> dict:
    """Ask the AI to read a job posting and return it as job form data.
    Raises NotAJobPost for a CV or anything else that isn't a job post."""
    taxonomy = await load_taxonomy(session)
    profile = await provider.extract_job_profile(text, list(taxonomy))
    check_is_job_post(profile)
    return profile_to_form(profile, taxonomy)
