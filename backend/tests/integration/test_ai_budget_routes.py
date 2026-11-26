"""The monthly AI budget, as people see it (user 2026-11-24: Claude "with a
limit so we won't spend too much").

When the month's budget is used up, the AI pauses until the 1st:
- "Fill with AI" says so clearly instead of a vague error;
- a CV upload still saves the file and says AI reading is paused, without
  queueing work or using the person's daily quota;
- the admin page shows the month's spend against the budget.
The budget arithmetic itself is in tests/test_claude_provider.py.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.cv import ParseJobTextRequest
from app.models.tables import ProGrant
from app.routers import admin as admin_router
from app.routers import cv as cv_router
from app.services.llm import ai_budget
from app.services.llm.ai_budget import AIBudgetExceeded

from tests.integration.test_ai_pro_only import upload_cv
from tests.test_claude_provider import FakeRedis

pytestmark = pytest.mark.asyncio


@pytest.fixture
def redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(ai_budget, "_redis_factory", lambda: fake)
    monkeypatch.setattr(settings, "AI_MONTHLY_BUDGET_USD", 10.0)
    return fake


async def use_up_the_budget(redis):
    await redis.hincrby(ai_budget.month_key(), "total_micro", 10_000_000)


async def give_pro(world, user_id):
    world.s.add(ProGrant(subject_type="user", subject_id=user_id, source="admin",
                         starts_at=datetime.now(timezone.utc) - timedelta(days=1)))
    await world.commit()


class BudgetUsedUp:
    async def extract_job_profile(self, text, taxonomy):
        raise AIBudgetExceeded()


async def test_fill_with_ai_says_the_ai_is_paused(session, world, monkeypatch, redis):
    emp = await world.employer()
    await give_pro(world, emp)

    async def free_quota(user_id, units):
        return None
    monkeypatch.setattr(cv_router, "consume_llm_units", free_quota)
    monkeypatch.setattr(cv_router, "get_llm_provider", lambda: BudgetUsedUp())
    with pytest.raises(HTTPException) as e:
        await cv_router.parse_job_text_route.__wrapped__(
            request=None, payload=ParseJobTextRequest(text="We need a junior React developer in Tel Aviv"),
            user={"id": str(emp), "role": "employer"}, session=session,
        )
    assert e.value.status_code == 503
    assert "paused" in e.value.detail


async def test_a_cv_upload_is_saved_but_not_read_while_the_ai_is_paused(session, world, monkeypatch, redis):
    worker = await world.worker([])
    await give_pro(world, worker)
    await use_up_the_budget(redis)
    out, queued = await upload_cv(session, worker, monkeypatch)
    assert out["url"].endswith("resume.pdf?token=t")
    assert out["analyzing"] is False
    assert out["ai_paused"] is True
    assert queued == []


async def test_with_budget_left_the_cv_is_read(session, world, monkeypatch, redis):
    worker = await world.worker([])
    await give_pro(world, worker)
    out, queued = await upload_cv(session, worker, monkeypatch)
    assert out["analyzing"] is True
    assert out["ai_paused"] is False
    assert len(queued) == 1


async def test_admins_see_the_months_ai_spend(redis):
    await redis.hincrby(ai_budget.month_key(), "total_micro", 2_500_000)
    await redis.hincrby(ai_budget.month_key(), "calls", 80)
    await redis.hincrby(ai_budget.month_key(), "cv:micro", 2_500_000)
    await redis.hincrby(ai_budget.month_key(), "cv:calls", 80)
    out = await admin_router.ai_usage(user={"id": "admin", "email": "admin@test.com"})
    assert out["spent_usd"] == pytest.approx(2.5)
    assert out["budget_usd"] == 10.0
    assert out["calls"] == 80
    assert out["by_feature"]["cv"]["calls"] == 80
    assert out["month"] == datetime.now(timezone.utc).strftime("%Y-%m")
    assert out["model"] == settings.CLAUDE_MODEL
