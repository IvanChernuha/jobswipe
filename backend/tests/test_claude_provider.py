"""Claude reads CVs and job posts, under a monthly spending cap (user 2026-11-24:
"use claude api for now with a limit so we won't spend too much").

No network: the Anthropic client and Redis are fakes. What matters:
- the CV / job text goes to Claude with the skill list in a cached system prompt,
  and the answer is checked against the skill list;
- every call's real cost (from the token usage Claude reports) is added to the
  month's spend, and once the month's budget is used up no call is made.
"""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import anthropic
import httpx
import pytest

from app.config import settings
from app.services.llm import ai_budget
from app.services.llm.ai_budget import AIBudgetExceeded, call_cost_usd
from app.services.llm.claude import AIRefused, ClaudeProvider

pytestmark = pytest.mark.asyncio

TAXONOMY = ["Python", "FastAPI", "PostgreSQL", "React", "Docker"]


class FakeRedis:
    """The few hash commands ai_budget uses."""

    def __init__(self, broken=False):
        self.hashes: dict[str, dict[str, int]] = {}
        self.broken = broken

    def _check(self):
        if self.broken:
            raise ConnectionError("redis down")

    async def hget(self, key, field):
        self._check()
        v = self.hashes.get(key, {}).get(field)
        return None if v is None else str(v)

    async def hincrby(self, key, field, n):
        self._check()
        h = self.hashes.setdefault(key, {})
        h[field] = h.get(field, 0) + n
        return h[field]

    async def hgetall(self, key):
        self._check()
        return {k: str(v) for k, v in self.hashes.get(key, {}).items()}

    async def expire(self, key, ttl):
        return True

    async def aclose(self):
        return None


@pytest.fixture
def redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(ai_budget, "_redis_factory", lambda: fake)
    monkeypatch.setattr(settings, "AI_MONTHLY_BUDGET_USD", 10.0)
    return fake


def usage(input=1000, output=500, cache_write=0, cache_read=0):
    return SimpleNamespace(input_tokens=input, output_tokens=output,
                           cache_creation_input_tokens=cache_write, cache_read_input_tokens=cache_read)


def answer(data: dict, stop_reason="end_turn", model="claude-opus-5-5", tokens=None):
    return SimpleNamespace(
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(data))],
        stop_reason=stop_reason, model=model, usage=tokens or usage(),
    )


def claude(response=None, model="claude-opus-5-5", error=None):
    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(
        create=AsyncMock(return_value=response, side_effect=error))))
    return ClaudeProvider(api_key="test", model=model, effort="low", client=client), client.beta.messages.create


CV_ANSWER = {
    "name": "Dana Levi", "location": "Haifa", "experience_years": 4,
    "bio": "Backend developer who builds APIs.", "tags": ["python", "FastAPI", "Kubernetes"],
}


# --- reading a CV ------------------------------------------------------------

async def test_reads_a_cv_into_a_profile(redis):
    provider, create = claude(answer(CV_ANSWER))
    profile = await provider.extract_cv_profile("Dana Levi, Haifa. 4 years of Python...", TAXONOMY)
    assert profile.name == "Dana Levi"
    assert profile.location == "Haifa"
    assert profile.experience_years == 4
    assert profile.bio == "Backend developer who builds APIs."
    # Only skills from the list, spelled as in the list; invented ones are dropped.
    assert profile.tags == ["Python", "FastAPI"]


async def test_the_cv_goes_in_the_message_and_the_skill_list_in_a_cached_system_prompt(redis):
    provider, create = claude(answer(CV_ANSWER))
    await provider.extract_cv_profile("Dana Levi, Haifa", TAXONOMY)
    kwargs = create.call_args.kwargs
    assert kwargs["model"] == "claude-opus-5-5"
    assert "Dana Levi, Haifa" in kwargs["messages"][0]["content"]
    system = kwargs["system"][0]
    assert system["cache_control"] == {"type": "ephemeral"}
    assert "Docker, FastAPI, PostgreSQL, Python, React" in system["text"]  # sorted: same bytes every call
    assert "Dana" not in system["text"]
    assert kwargs["output_config"]["effort"] == "low"
    assert kwargs["output_config"]["format"]["type"] == "json_schema"


async def test_the_same_skill_list_gives_the_same_system_prompt(redis):
    """Prompt caching only works if the cached prefix is byte-for-byte the same."""
    provider, create = claude(answer(CV_ANSWER))
    await provider.extract_cv_profile("first", TAXONOMY)
    await provider.extract_cv_profile("second", list(reversed(TAXONOMY)))
    first, second = (c.kwargs["system"] for c in create.call_args_list)
    assert first == second


async def test_opus_falls_back_to_another_model_if_it_declines(redis):
    provider, create = claude(answer(CV_ANSWER))
    await provider.extract_cv_profile("cv", TAXONOMY)
    kwargs = create.call_args.kwargs
    assert kwargs["fallbacks"] == "default"
    assert kwargs["betas"] == ["server-side-fallback-2026-07-01"]


async def test_haiku_has_no_fallback(redis):
    provider, create = claude(answer(CV_ANSWER, model="claude-haiku-5-5"), model="claude-haiku-5-5")
    await provider.extract_cv_profile("cv", TAXONOMY)
    assert "fallbacks" not in create.call_args.kwargs
    assert create.call_args.kwargs["model"] == "claude-haiku-5-5"


async def test_a_declined_cv_raises_and_is_still_counted(redis):
    provider, _ = claude(answer({}, stop_reason="refusal"))
    with pytest.raises(AIRefused):
        await provider.extract_cv_profile("cv", TAXONOMY)
    assert (await ai_budget.spend_summary())["calls"] == 1


async def test_a_cut_off_answer_raises(redis):
    provider, _ = claude(answer({}, stop_reason="max_tokens"))
    with pytest.raises(ValueError):
        await provider.extract_cv_profile("cv", TAXONOMY)


# --- the monthly cap ---------------------------------------------------------

def test_cost_of_a_call():
    # Opus 5.5: $4 in, $20 out, cache writes 1.25x input, cache reads $0.20 per million.
    cost = call_cost_usd("claude-opus-5-5", usage(input=1_000_000, output=100_000, cache_write=100_000, cache_read=1_000_000))
    assert cost == pytest.approx(4.0 + 2.0 + 0.5 + 0.2)


def test_an_unknown_model_is_priced_high_not_free():
    assert call_cost_usd("claude-future-9", usage(input=1_000_000, output=0)) >= 4.0


async def test_every_call_adds_its_cost_to_the_month(redis):
    provider, _ = claude(answer(CV_ANSWER, tokens=usage(input=10_000, output=1_000)))
    await provider.extract_cv_profile("cv", TAXONOMY)
    await provider.extract_cv_profile("cv", TAXONOMY)
    summary = await ai_budget.spend_summary()
    assert summary["spent_usd"] == pytest.approx(2 * (0.04 + 0.02))
    assert summary["calls"] == 2
    assert summary["budget_usd"] == 10.0
    assert summary["by_feature"]["cv"] == {"calls": 2, "spent_usd": pytest.approx(0.12)}


async def test_when_the_months_budget_is_used_up_claude_is_not_called(redis, monkeypatch):
    monkeypatch.setattr(settings, "AI_MONTHLY_BUDGET_USD", 0.05)
    provider, create = claude(answer(CV_ANSWER, tokens=usage(input=10_000, output=1_000)))
    await provider.extract_cv_profile("cv", TAXONOMY)  # $0.06: goes over
    with pytest.raises(AIBudgetExceeded):
        await provider.extract_cv_profile("cv", TAXONOMY)
    assert create.await_count == 1


async def test_a_budget_of_zero_turns_the_ai_off(redis, monkeypatch):
    monkeypatch.setattr(settings, "AI_MONTHLY_BUDGET_USD", 0)
    provider, create = claude(answer(CV_ANSWER))
    with pytest.raises(AIBudgetExceeded):
        await provider.extract_cv_profile("cv", TAXONOMY)
    create.assert_not_awaited()


async def test_the_anthropic_accounts_own_spend_limit_counts_as_budget_used_up(redis):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    error = anthropic.PaymentRequiredError(
        "spend limit", response=httpx.Response(402, request=request), body=None)
    provider, _ = claude(error=error)
    with pytest.raises(AIBudgetExceeded):
        await provider.extract_cv_profile("cv", TAXONOMY)


async def test_if_redis_is_down_it_still_works(monkeypatch):
    monkeypatch.setattr(ai_budget, "_redis_factory", lambda: FakeRedis(broken=True))
    monkeypatch.setattr(settings, "AI_MONTHLY_BUDGET_USD", 10.0)
    provider, _ = claude(answer(CV_ANSWER))
    profile = await provider.extract_cv_profile("cv", TAXONOMY)
    assert profile.name == "Dana Levi"


# --- job posts and tags ------------------------------------------------------

async def test_reads_a_job_post(redis):
    provider, create = claude(answer({
        "title": "Backend Developer", "description": "Build our payment APIs.", "location": "Tel Aviv",
        "remote": True, "salary_min": 18000, "salary_max": 25000, "min_experience_years": 3,
        "required_tags": ["Python"], "preferred_tags": ["fastapi"], "nice_tags": ["Docker", "Rust"],
    }))
    job = await provider.extract_job_profile("We're hiring a backend developer...", TAXONOMY)
    assert (job.title, job.location, job.remote) == ("Backend Developer", "Tel Aviv", True)
    assert (job.salary_min, job.salary_max, job.min_experience_years) == (18000, 25000, 3)
    assert (job.required_tags, job.preferred_tags, job.nice_tags) == (["Python"], ["FastAPI"], ["Docker"])
    # Salaries in the app are shekels per month.
    assert "per month" in create.call_args.kwargs["system"][0]["text"]
    assert "₪" in create.call_args.kwargs["system"][0]["text"]


async def test_tags_for_one_text(redis):
    provider, _ = claude(answer({"tags": ["React", "Vue"]}))
    assert await provider.extract_tags("React developer", TAXONOMY) == ["React"]


async def test_tags_for_many_jobs_in_one_call(redis):
    provider, create = claude(answer({"jobs": [
        {"job_id": "a", "tags": ["Python", "Go"]}, {"job_id": "b", "tags": ["react"]},
    ]}))
    result = await provider.extract_tags_batch(
        [{"job_id": "a", "description": "Python dev"}, {"job_id": "b", "description": "React dev"}], TAXONOMY)
    assert result == {"a": ["Python"], "b": ["React"]}
    assert create.await_count == 1


# --- choosing Claude ---------------------------------------------------------

def test_the_factory_gives_claude(monkeypatch):
    from app.services.llm import factory
    monkeypatch.setattr(settings, "LLM_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "CLAUDE_MODEL", "claude-opus-5-5")
    provider = factory.get_llm_provider()
    assert isinstance(provider, ClaudeProvider)
    assert provider.model == "claude-opus-5-5"


def test_the_factory_needs_a_key(monkeypatch):
    from app.services.llm import factory
    monkeypatch.setattr(settings, "LLM_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        factory.get_llm_provider()
