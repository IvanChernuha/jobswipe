from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class CVProfile:
    """Structured data extracted from a CV."""
    tags: list[str] = field(default_factory=list)
    name: str | None = None
    location: str | None = None
    experience_years: int | None = None
    bio: str | None = None


class LLMProvider(ABC):
    """Abstract base for LLM tag extraction providers."""

    @abstractmethod
    async def extract_tags(self, text: str, taxonomy: list[str]) -> list[str]:
        """
        Given raw text and the full list of valid tag names,
        return the subset of tags that apply.
        """
        ...

    @abstractmethod
    async def extract_cv_profile(self, text: str, taxonomy: list[str]) -> CVProfile:
        """
        Extract full profile data from CV text in a single LLM call:
        name, location, experience_years, bio, and matched tags.
        """
        ...

    @abstractmethod
    async def extract_tags_batch(
        self, jobs: list[dict], taxonomy: list[str]
    ) -> dict[str, list[str]]:
        """
        Given a list of {job_id, description} dicts and the tag taxonomy,
        return {job_id: [matched_tag_names]} for all jobs in a single API call.
        """
        ...
