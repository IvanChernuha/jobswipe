"""Characterization tests: what the two feeds do TODAY.

They lock in current behaviour before the profession layer changes the feeds
(docs/worklog/profession-layer.md §5.1, C1-C6). They must pass on the code as
it is; if one fails before any feed change, the test is wrong, not the app.

Worker feed   = app.routers.employers.worker_feed  (jobs shown to a worker)
Employer feed = app.routers.workers.employer_feed  (workers shown to an employer)
"""
import uuid
from datetime import datetime, timezone

import pytest

from app.models.tables import BlockedUser, JobPostingTag, OrgMember, Organization, Swipe, WorkerTag
from app.routers.employers import _sync_job_tags, worker_feed
from app.routers.workers import _sync_worker_tags, employer_feed
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


async def jobs_for(session, worker_id, **filters):
    params = dict(page=1, size=50, location=None, salary_min=None, remote=None)
    params.update(filters)
    return await worker_feed(user={"id": str(worker_id), "role": "worker"}, session=session, **params)


async def workers_for(session, employer_id, **filters):
    params = dict(page=1, size=50, location=None, experience_min=None, experience_max=None)
    params.update(filters)
    return await employer_feed(user={"id": str(employer_id), "role": "employer"}, session=session, **params)


def ids(cards):
    return [c["id"] for c in cards]


# ── C1: required tags (worker feed) ──────────────────────────────────────────

async def test_c1_required_tags_all_needed(session, world):
    emp = await world.employer()
    job = await world.job(emp, required=["React", "Python"])
    partial = await world.worker(["React"])
    full = await world.worker(["React", "Python"])
    await world.commit()

    assert ids(await jobs_for(session, partial)) == []
    assert ids(await jobs_for(session, full)) == [str(job)]


async def test_c1_job_without_required_or_preferred_shown_to_anyone(session, world):
    emp = await world.employer()
    job = await world.job(emp, nice=["Go"])
    tagless = await world.worker([])
    await world.commit()

    cards = await jobs_for(session, tagless)
    assert ids(cards) == [str(job)]
    assert cards[0]["match_score"] == {"matched": 0, "total": 1, "percentage": 0}


# ── C2: preferred tags (worker feed) ─────────────────────────────────────────

async def test_c2_preferred_tags_need_at_least_one(session, world):
    emp = await world.employer()
    job = await world.job(emp, preferred=["Docker", "Kubernetes"])
    neither = await world.worker(["Python"])
    one = await world.worker(["Kubernetes"])
    await world.commit()

    assert ids(await jobs_for(session, neither)) == []
    assert ids(await jobs_for(session, one)) == [str(job)]


# ── C3: related skills (tag_implications) ────────────────────────────────────

async def test_c3_implied_skill_satisfies_required(session, world):
    await world.implies("CUDA", "C++")
    emp = await world.employer()
    job = await world.job(emp, required=["C++"])
    cuda_dev = await world.worker(["CUDA"])
    await world.commit()

    assert ids(await jobs_for(session, cuda_dev)) == [str(job)]


async def test_c3_required_tag_is_expanded_too(session, world):
    # Today the job's REQUIRED tags are expanded as well, so requiring React
    # (which implies JavaScript) also requires JavaScript. A worker tagged
    # React expands to JavaScript too, so this only bites when the implication
    # is one-way from the job's side; it is locked in here as-is.
    await world.implies("React", "JavaScript")
    emp = await world.employer()
    job = await world.job(emp, required=["React"])
    react_dev = await world.worker(["React"])
    await world.commit()

    assert ids(await jobs_for(session, react_dev)) == [str(job)]


async def test_c3_implication_is_one_way(session, world):
    await world.implies("CUDA", "C++")
    emp = await world.employer()
    await world.job(emp, required=["CUDA"])
    cpp_dev = await world.worker(["C++"])
    await world.commit()

    assert ids(await jobs_for(session, cpp_dev)) == []


# ── C4: score and order (worker feed) ────────────────────────────────────────

async def test_c4_score_is_overlap_over_expanded_job_tags(session, world):
    await world.implies("React", "JavaScript")
    emp = await world.employer()
    await world.job(emp, nice=["React", "Python", "Docker"])  # expands to 4 tags
    dev = await world.worker(["React", "Python"])              # expands to 3
    await world.commit()

    [card] = await jobs_for(session, dev)
    assert card["match_score"] == {"matched": 3, "total": 4, "percentage": 75}


async def test_c4_sorted_by_percentage_then_matched(session, world):
    emp = await world.employer()
    low = await world.job(emp, nice=["Go", "Rust", "Java", "Kotlin"], title="25%")
    high = await world.job(emp, nice=["Go"], title="100%")
    mid_small = await world.job(emp, nice=["Go", "Rust"], title="50% of 2")
    mid_big = await world.job(emp, nice=["Go", "Rust", "Python", "Java"], title="50% of 4")
    dev = await world.worker(["Go", "Python"])
    await world.commit()

    assert ids(await jobs_for(session, dev)) == [str(high), str(mid_big), str(mid_small), str(low)]


async def test_c4_pagination_applies_after_sorting(session, world):
    emp = await world.employer()
    jobs = [await world.job(emp, nice=["Go"] + [f"T{i}{j}" for j in range(i)]) for i in range(5)]
    dev = await world.worker(["Go"])
    await world.commit()

    page1 = ids(await jobs_for(session, dev, page=1, size=2))
    page2 = ids(await jobs_for(session, dev, page=2, size=2))
    assert page1 == [str(jobs[0]), str(jobs[1])]
    assert page2 == [str(jobs[2]), str(jobs[3])]


# ── Worker feed: which jobs are even considered ──────────────────────────────

async def test_worker_feed_hides_inactive_expired_swiped_suspended_blocked(session, world):
    emp = await world.employer()
    visible = await world.job(emp, title="visible")
    await world.job(emp, title="inactive", active=False)
    await world.job(emp, title="expired", expires_in_days=-1)
    swiped = await world.job(emp, title="swiped")
    suspended_emp = await world.employer(suspended_at=datetime.now(timezone.utc))
    await world.job(suspended_emp, title="suspended employer")
    blocked_emp = await world.employer()
    await world.job(blocked_emp, title="blocked employer")
    dev = await world.worker([])
    await world.s.flush()
    session.add(Swipe(id=uuid.uuid4(), swiper_id=dev, swiper_type="worker", target_id=swiped, direction="pass"))
    session.add(BlockedUser(blocker_id=blocked_emp, blocked_id=dev))
    await world.commit()

    assert ids(await jobs_for(session, dev)) == [str(visible)]


async def test_worker_feed_filters(session, world):
    emp = await world.employer()
    tlv_remote = await world.job(emp, location="Tel Aviv", remote=True, salary_max=20000)
    await world.job(emp, location="Haifa", remote=False, salary_max=9000)
    dev = await world.worker([])
    await world.commit()

    assert ids(await jobs_for(session, dev, location="tel aviv")) == [str(tlv_remote)]
    assert ids(await jobs_for(session, dev, remote=True)) == [str(tlv_remote)]
    assert ids(await jobs_for(session, dev, salary_min=15000)) == [str(tlv_remote)]


# ── C5: the employer feed (mirror) ───────────────────────────────────────────

async def test_c5_worker_must_fit_any_one_active_job(session, world):
    emp = await world.employer()
    await world.job(emp, required=["React", "Python"])
    await world.job(emp, required=["Go"])
    react_only = await world.worker(["React"], name="React only")
    go_dev = await world.worker(["Go"], name="Go dev")
    await world.commit()

    assert ids(await workers_for(session, emp)) == [str(go_dev)]
    assert str(react_only) not in ids(await workers_for(session, emp))


async def test_c5_no_active_jobs_shows_every_worker(session, world):
    emp = await world.employer()
    await world.job(emp, required=["Rust"], active=False)
    a = await world.worker(["Python"], name="A")
    b = await world.worker([], name="B")
    await world.commit()

    assert set(ids(await workers_for(session, emp))) == {str(a), str(b)}


async def test_c5_expired_but_active_job_still_counts(session, world):
    # Unlike the worker feed, the employer feed doesn't check expires_at.
    emp = await world.employer()
    await world.job(emp, required=["Rust"], expires_in_days=-5)
    rust_dev = await world.worker(["Rust"])
    python_dev = await world.worker(["Python"])
    await world.commit()

    assert ids(await workers_for(session, emp)) == [str(rust_dev)]
    assert str(python_dev) not in ids(await workers_for(session, emp))


async def test_c5_preferred_and_implications(session, world):
    await world.implies("CUDA", "C++")
    emp = await world.employer()
    await world.job(emp, required=["C++"], preferred=["Docker", "Linux"])
    fits = await world.worker(["CUDA", "Linux"])
    no_preferred = await world.worker(["C++"])
    await world.commit()

    assert ids(await workers_for(session, emp)) == [str(fits)]
    assert str(no_preferred) not in ids(await workers_for(session, emp))


async def test_c5_score_against_all_team_job_tags_combined(session, world):
    emp = await world.employer()
    await world.job(emp, nice=["React", "Python"])
    await world.job(emp, nice=["Go", "Rust"])
    dev = await world.worker(["React", "Go"])
    await world.commit()

    [card] = await workers_for(session, emp)
    assert card["id"] == str(dev)
    assert card["match_score"] == {"matched": 2, "total": 4, "percentage": 50}


async def test_c5_team_members_jobs_count_for_each_other(session, world):
    owner = await world.employer(company="Team")
    teammate = await world.employer(company="Team")
    org_id = uuid.uuid4()
    await world.s.flush()
    session.add(Organization(id=org_id, name="Team", owner_id=owner))
    await world.s.flush()
    session.add(OrgMember(id=uuid.uuid4(), org_id=org_id, user_id=owner, role="owner"))
    session.add(OrgMember(id=uuid.uuid4(), org_id=org_id, user_id=teammate, role="manager"))
    await world.job(teammate, required=["Go"])
    go_dev = await world.worker(["Go"])
    await world.worker(["Python"])
    await world.commit()

    assert ids(await workers_for(session, owner)) == [str(go_dev)]


async def test_c5_hides_unnamed_swiped_suspended_blocked(session, world):
    emp = await world.employer()
    visible = await world.worker([], name="Visible")
    await world.worker([], name="")  # unfinished onboarding
    swiped = await world.worker([], name="Swiped")
    suspended = await world.user("worker", suspended_at=datetime.now(timezone.utc))
    await world.s.flush()
    from app.models.tables import WorkerProfile
    session.add(WorkerProfile(user_id=suspended, name="Suspended"))
    blocker = await world.worker([], name="Blocked me")
    await world.s.flush()
    session.add(Swipe(id=uuid.uuid4(), swiper_id=emp, swiper_type="employer", target_id=swiped, direction="like"))
    session.add(BlockedUser(blocker_id=blocker, blocked_id=emp))
    await world.commit()

    assert ids(await workers_for(session, emp)) == [str(visible)]


async def test_c5_experience_and_location_filters(session, world):
    emp = await world.employer()
    junior = await world.worker([], name="Junior", experience_years=0, location="Jerusalem")
    await world.worker([], name="Senior", experience_years=8, location="Tel Aviv")
    await world.commit()

    assert ids(await workers_for(session, emp, experience_max=1)) == [str(junior)]
    assert ids(await workers_for(session, emp, location="jeru")) == [str(junior)]


# ── C6: saving tags ──────────────────────────────────────────────────────────

async def test_c6_job_tag_levels_required_beats_preferred_beats_nice(session, world):
    emp = await world.employer()
    job = await world.job(emp)
    for name in ("A", "B", "C"):
        await world.tag(name)
    await world.commit()
    a, b, c = (str(world.tags[n]) for n in ("A", "B", "C"))

    await _sync_job_tags(session, job, nice_ids=[a, b, c], required_ids=[a], preferred_ids=[a, b])

    rows = (await session.execute(
        select(JobPostingTag.tag_id, JobPostingTag.requirement).where(JobPostingTag.job_posting_id == job)
    )).all()
    assert {(str(t), r) for t, r in rows} == {(a, "required"), (b, "preferred"), (c, "nice")}


async def test_c6_job_tags_replaced_not_merged(session, world):
    emp = await world.employer()
    job = await world.job(emp, required=["Old"])
    await world.tag("New")
    await world.commit()

    await _sync_job_tags(session, job, nice_ids=[], required_ids=[str(world.tags["New"])], preferred_ids=[])

    rows = (await session.execute(
        select(JobPostingTag.tag_id).where(JobPostingTag.job_posting_id == job)
    )).scalars().all()
    assert rows == [world.tags["New"]]


async def test_c6_worker_tags_deduped_invalid_dropped_replaced(session, world):
    dev = await world.worker(["Old"])
    await world.tag("Python")
    await world.commit()
    py = str(world.tags["Python"])

    await _sync_worker_tags(session, str(dev), [py, py, "not-a-uuid", str(uuid.uuid4())])
    await session.commit()

    rows = (await session.execute(select(WorkerTag.tag_id).where(WorkerTag.worker_id == dev))).scalars().all()
    assert rows == [world.tags["Python"]]
