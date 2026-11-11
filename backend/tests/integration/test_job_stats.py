"""The numbers on each job in "Your Jobs" (user request 2026-11-11: show
likes and super likes separately)."""
import uuid
from datetime import datetime, timezone

import pytest

from app.models.tables import Match, Swipe
from app.routers.employers import list_my_jobs

pytestmark = pytest.mark.asyncio


async def swipe(world, worker, job, direction):
    world.s.add(Swipe(id=uuid.uuid4(), swiper_id=worker, swiper_type="worker", target_id=job,
                      direction=direction, created_at=datetime.now(timezone.utc)))
    await world.s.flush()


async def test_likes_and_super_likes_are_counted_separately(session, world):
    emp = await world.employer()
    job = await world.job(emp, title="Frontend")
    other_job = await world.job(emp, title="Backend")
    for direction in ("like", "like", "super_like", "pass"):
        await swipe(world, await world.worker([]), job, direction)
    matched = await world.worker([])
    await swipe(world, matched, job, "super_like")
    world.s.add(Match(id=uuid.uuid4(), worker_id=matched, employer_id=emp, job_posting_id=job,
                      status="active", matched_at=datetime.now(timezone.utc)))
    await world.commit()

    jobs = {j["title"]: j for j in await list_my_jobs(user={"id": str(emp), "role": "employer"}, session=session)}

    frontend = jobs["Frontend"]
    assert frontend["swipe_count"] == 5          # everyone who saw it and decided
    assert frontend["like_count"] == 4           # all likes, super likes included (as before)
    assert frontend["super_like_count"] == 2
    assert frontend["match_count"] == 1
    assert (jobs["Backend"]["like_count"], jobs["Backend"]["super_like_count"]) == (0, 0)
