"""Mobile 2026-11-09 decisions (docs/worklog/mobile-app-expo.md):

- Employers can look at the feed for ONE of their live jobs (job switcher).
  A like still counts for the company, as before.
- Both feeds say when the other side already liked / super liked you, and
  those cards come first (super likes before likes).
- A match shows the other side's full profile; after a match the employer
  can open the candidate's CV through a fresh, short-lived link.
"""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.models.tables import Match, Swipe
from app.routers import matches as matches_router
from app.routers.employers import worker_feed
from app.routers.matches import get_match, get_match_resume
from app.routers.workers import employer_feed

pytestmark = pytest.mark.asyncio


async def jobs_for(session, worker_id):
    return await worker_feed(page=1, size=50, location=None, salary_min=None, remote=None,
                             user={"id": str(worker_id), "role": "worker"}, session=session)


async def workers_for(session, employer_id, job_id=None):
    return await employer_feed(page=1, size=50, location=None, experience_min=None, experience_max=None,
                               job_id=job_id, user={"id": str(employer_id), "role": "employer"}, session=session)


def ids(cards):
    return [c["id"] for c in cards]


async def swipe(world, swiper, target, direction, swiper_type):
    world.s.add(Swipe(id=uuid.uuid4(), swiper_id=swiper, swiper_type=swiper_type, target_id=target,
                      direction=direction, created_at=datetime.now(timezone.utc)))
    await world.s.flush()


# ── Job switcher (employer feed) ─────────────────────────────────────────────

async def test_feed_for_one_job_shows_only_who_fits_that_job(session, world):
    emp = await world.employer()
    frontend = await world.job(emp, required=["React"], title="Frontend")
    backend = await world.job(emp, required=["Python"], title="Backend")
    react_dev = await world.worker(["React"])
    python_dev = await world.worker(["Python"])
    await world.commit()

    assert sorted(ids(await workers_for(session, emp))) == sorted([str(react_dev), str(python_dev)])

    cards = await workers_for(session, emp, job_id=str(frontend))
    assert ids(cards) == [str(react_dev)]
    assert cards[0]["match_score"]["job_id"] == str(frontend)
    assert ids(await workers_for(session, emp, job_id=str(backend))) == [str(python_dev)]


async def test_feed_for_a_job_that_is_not_yours_or_not_live_is_refused(session, world):
    emp = await world.employer()
    other = await world.employer()
    theirs = await world.job(other, title="Theirs")
    paused = await world.job(emp, active=False, title="Paused")
    expired = await world.job(emp, expires_in_days=-1, title="Expired")
    await world.commit()

    for job in (theirs, paused, expired):
        with pytest.raises(HTTPException) as e:
            await workers_for(session, emp, job_id=str(job))
        assert e.value.status_code == 404


# ── "Liked you" on both feeds ────────────────────────────────────────────────

async def test_employer_feed_says_who_liked_your_jobs_and_puts_them_first(session, world):
    emp = await world.employer()
    job = await world.job(emp, nice=["React", "TypeScript"])
    other_emp = await world.employer()
    other_job = await world.job(other_emp, nice=["React"])
    best_fit = await world.worker(["React", "TypeScript"])  # 100%, but liked nothing
    liker = await world.worker(["React"])
    super_liker = await world.worker([])
    elsewhere = await world.worker(["React"])
    await swipe(world, liker, job, "like", "worker")
    await swipe(world, super_liker, job, "super_like", "worker")
    await swipe(world, elsewhere, other_job, "super_like", "worker")  # not your job
    await world.commit()

    cards = await workers_for(session, emp)
    by_id = {c["id"]: c for c in cards}
    assert ids(cards)[:2] == [str(super_liker), str(liker)]
    assert by_id[str(super_liker)]["liked_you"] == "super_like"
    assert by_id[str(liker)]["liked_you"] == "like"
    assert by_id[str(best_fit)]["liked_you"] is None
    assert by_id[str(elsewhere)]["liked_you"] is None


async def test_a_pass_is_not_a_like(session, world):
    emp = await world.employer()
    job = await world.job(emp)
    passer = await world.worker([])
    await swipe(world, passer, job, "pass", "worker")
    await world.commit()
    assert (await workers_for(session, emp))[0]["liked_you"] is None


async def test_worker_feed_says_which_employers_liked_you_and_puts_them_first(session, world):
    worker = await world.worker(["React"])
    fan = await world.employer("Fan Co")
    big_fan = await world.employer("Big Fan Co")
    stranger = await world.employer("Stranger Co")
    fan_job = await world.job(fan, nice=["Go"])            # 0% fit
    big_fan_job = await world.job(big_fan, nice=["Go"])    # 0% fit
    best_job = await world.job(stranger, nice=["React"])   # 100% fit, no like
    await swipe(world, fan, worker, "like", "employer")
    await swipe(world, big_fan, worker, "super_like", "employer")
    await world.commit()

    cards = await jobs_for(session, worker)
    by_id = {c["id"]: c for c in cards}
    assert ids(cards) == [str(big_fan_job), str(fan_job), str(best_job)]
    assert by_id[str(big_fan_job)]["liked_you"] == "super_like"
    assert by_id[str(fan_job)]["liked_you"] == "like"
    assert by_id[str(best_job)]["liked_you"] is None


# ── Full profile on a match, CV after a match ────────────────────────────────

async def make_match(world, worker, emp, job):
    mid = uuid.uuid4()
    world.s.add(Match(id=mid, worker_id=worker, employer_id=emp, job_posting_id=job,
                      status="active", matched_at=datetime.now(timezone.utc)))
    await world.s.flush()
    return mid


async def test_employer_sees_the_candidates_full_profile_on_a_match(session, world):
    emp = await world.employer("Wix")
    job = await world.job(emp, title="Frontend")
    worker = await world.worker(["React"], name="Dana Levi", bio="Bootcamp grad", location="Haifa",
                                experience_years=2, resume_url="https://old-signed-link")
    mid = await make_match(world, worker, emp, job)
    await world.commit()

    out = await get_match(str(mid), user={"id": str(emp), "role": "employer"}, session=session)
    w = out["worker"]
    assert (w["name"], w["bio"], w["location"], w["experience_years"]) == ("Dana Levi", "Bootcamp grad", "Haifa", 2)
    assert [t["name"] for t in w["tags"]] == ["React"]
    assert w["has_resume"] is True
    assert "resume_url" not in w  # the stored link expires; the app asks for a fresh one


async def test_worker_sees_the_full_job_on_a_match(session, world):
    emp = await world.employer("Wix")
    job = await world.job(emp, required=["React"], title="Frontend", description="Build our editor",
                          salary_min=15000, salary_max=22000, remote=True, location="Tel Aviv")
    worker = await world.worker(["React"])
    mid = await make_match(world, worker, emp, job)
    await world.commit()

    out = await get_match(str(mid), user={"id": str(worker), "role": "worker"}, session=session)
    e = out["employer"]
    assert (e["company_name"], e["job_title"], e["description"]) == ("Wix", "Frontend", "Build our editor")
    assert (e["salary_min"], e["salary_max"], e["remote"], e["location"]) == (15000, 22000, True, "Tel Aviv")
    assert [(t["name"], t["requirement"]) for t in e["tags"]] == [("React", "required")]


async def test_matched_employer_gets_a_fresh_cv_link(session, world, monkeypatch):
    emp = await world.employer()
    job = await world.job(emp)
    worker = await world.worker([], resume_url="https://old-signed-link")
    mid = await make_match(world, worker, emp, job)
    await world.commit()
    asked = []
    monkeypatch.setattr(matches_router, "fresh_resume_url", lambda wid: asked.append(wid) or "https://fresh")

    out = await get_match_resume(str(mid), user={"id": str(emp), "role": "employer"}, session=session)
    assert out == {"url": "https://fresh"}
    assert asked == [str(worker)]


async def test_cv_link_only_for_the_matched_employer(session, world, monkeypatch):
    emp = await world.employer()
    stranger = await world.employer()
    job = await world.job(emp)
    worker = await world.worker([], resume_url="https://old-signed-link")
    mid = await make_match(world, worker, emp, job)
    await world.commit()
    monkeypatch.setattr(matches_router, "fresh_resume_url", lambda wid: "https://fresh")

    with pytest.raises(HTTPException) as e:
        await get_match_resume(str(mid), user={"id": str(stranger), "role": "employer"}, session=session)
    assert e.value.status_code == 403


async def test_no_cv_uploaded_says_so(session, world, monkeypatch):
    emp = await world.employer()
    job = await world.job(emp)
    worker = await world.worker([])
    mid = await make_match(world, worker, emp, job)
    await world.commit()
    monkeypatch.setattr(matches_router, "fresh_resume_url", lambda wid: None)

    with pytest.raises(HTTPException) as e:
        await get_match_resume(str(mid), user={"id": str(emp), "role": "employer"}, session=session)
    assert e.value.status_code == 404
