"""AI reading a job posting typed into the form (mobile "Fill with AI").

The LLM is faked; what is tested is our side: the skill list it is given,
how its answer maps onto real tag ids (unknown names dropped, case ignored),
and the shape the app receives (same as parse-job-files, minus the filename).
"""
import pytest

from app.models.cv import ParseJobTextRequest
from app.services.job_parsing import parse_job_text
from app.services.llm.base import JobProfile


class FakeProvider:
    def __init__(self, profile: JobProfile):
        self.profile = profile
        self.calls: list[tuple[str, list[str]]] = []

    async def extract_job_profile(self, text: str, taxonomy: list[str]) -> JobProfile:
        self.calls.append((text, taxonomy))
        return self.profile


@pytest.mark.asyncio
async def test_maps_the_ai_answer_onto_real_skills(world):
    for name in ("React", "TypeScript", "Docker", "Python"):
        await world.tag(name)
    await world.commit()
    ai = FakeProvider(JobProfile(
        title="Junior React Developer", description="Build our dashboard", location="Tel Aviv",
        remote=True, salary_min=14000, salary_max=18000, min_experience_years=1,
        required_tags=["React"], preferred_tags=["TypeScript"], nice_tags=["Docker", "Kubernetes"],
    ))

    parsed = await parse_job_text(world.s, ai, "We need a junior React developer...")

    assert parsed == {
        "title": "Junior React Developer", "description": "Build our dashboard", "location": "Tel Aviv",
        "remote": True, "salary_min": 14000, "salary_max": 18000, "min_experience_years": 1,
        "required_tag_ids": [str(world.tags["React"])],
        "preferred_tag_ids": [str(world.tags["TypeScript"])],
        "tag_ids": [str(world.tags["Docker"])],  # Kubernetes is not a known skill: dropped
        "required_tags": ["React"], "preferred_tags": ["TypeScript"], "nice_tags": ["Docker"],
    }


@pytest.mark.asyncio
async def test_the_ai_is_given_the_text_and_the_whole_skill_list(world):
    for name in ("React", "Python"):
        await world.tag(name)
    await world.commit()
    ai = FakeProvider(JobProfile())

    await parse_job_text(world.s, ai, "Python backend role")

    text, taxonomy = ai.calls[0]
    assert text == "Python backend role"
    assert sorted(taxonomy) == ["Python", "React"]


@pytest.mark.asyncio
async def test_nothing_recognised_gives_empty_skill_lists(world):
    await world.tag("React")
    await world.commit()
    parsed = await parse_job_text(world.s, FakeProvider(JobProfile(title="Chef")), "Head chef wanted")
    assert parsed["title"] == "Chef"
    assert parsed["required_tag_ids"] == parsed["preferred_tag_ids"] == parsed["tag_ids"] == []


@pytest.mark.parametrize("text", ["", "   ", "too short"])
def test_request_needs_some_real_text(text):
    with pytest.raises(ValueError):
        ParseJobTextRequest(text=text)


def test_request_caps_the_length():
    with pytest.raises(ValueError):
        ParseJobTextRequest(text="x" * 20001)
    assert ParseJobTextRequest(text="  We need a React developer in Tel Aviv  ").text == "We need a React developer in Tel Aviv"
