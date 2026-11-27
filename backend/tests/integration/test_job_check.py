"""The job check across every way of adding a job (user 2026-11-26): "if we
add a job via any possible way and it doesn't meet the requirements, or he
sent the wrong file, it lets him know and check".

- The form (create / edit / switch on): a job can't go live without a title,
  a real description, a location (or remote) and a skill. The answer says
  what's missing. A switched-off job may be saved unfinished (a draft).
- Every job in the list carries its issues, so the app can mark the ones to check.
- "Fill with AI" and job files: a CV or anything that isn't a job post is
  refused with a clear reason; a file with no text says so (e.g. a scan).
- Comeet: an imported job that's missing something comes in switched off,
  marked to check, and switches on by itself once a later sync completes it.
"""
import copy
import json
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app.models.cv import ParseJobTextRequest
from app.models.employer import JobPostingCreate, JobPostingUpdate
from app.models.tables.job import JobPosting
from app.routers import cv as cv_router
from app.routers import employers as employers_router
from app.services import ats_sync
from app.services.llm.base import JobProfile

from tests.integration.test_ai_pro_only import give_pro
from tests.integration.test_comeet_import import comeet_jobs, comeet_returns, connect, the_connection

pytestmark = pytest.mark.asyncio

GOOD = dict(title="Junior QA Engineer", description="Test our mobile app before every release and write test plans.",
            location="Tel Aviv", salary_min=12000, salary_max=15000)


def boss(emp):
    return {"id": str(emp), "role": "employer", "email": "hr@startup.test", "org_role": "owner", "org_id": None}


async def employer_with_skill(world):
    emp = await world.employer()
    qa = await world.tag("QA")
    await give_pro(world, emp)
    return emp, str(qa)


async def create(session, emp, **fields):
    return await employers_router.create_job(body=JobPostingCreate(**fields), user=boss(emp), session=session)


# --- the form --------------------------------------------------------------------

async def test_a_complete_job_goes_live(session, world):
    emp, qa = await employer_with_skill(world)
    job = await create(session, emp, **GOOD, required_tag_ids=[qa])
    assert job["active"] is True
    assert job["issues"] == []


async def test_an_incomplete_job_is_refused_with_what_is_missing(session, world):
    emp, _ = await employer_with_skill(world)
    with pytest.raises(HTTPException) as e:
        await create(session, emp, title="Untitled", description="Join us!")
    assert e.value.status_code == 422
    assert e.value.detail == ("Before this job can go live, add: a description (a few sentences), "
                              "a location (or mark it remote), at least one skill.")


async def test_suggestions_come_back_but_do_not_block(session, world):
    emp, qa = await employer_with_skill(world)
    job = await create(session, emp, **{**GOOD, "salary_min": 0, "salary_max": 0}, tag_ids=[qa])
    assert job["active"] is True
    assert [i["code"] for i in job["issues"]] == ["required_skills", "salary"]


async def test_a_live_job_cannot_be_edited_into_an_incomplete_one(session, world):
    emp, qa = await employer_with_skill(world)
    job = await create(session, emp, **GOOD, required_tag_ids=[qa])
    with pytest.raises(HTTPException) as e:
        await employers_router.update_job(job_id=job["id"], body=JobPostingUpdate(description="Short"),
                                          user=boss(emp), session=session)
    assert e.value.status_code == 422
    assert "a description" in e.value.detail


async def test_a_switched_off_job_can_be_saved_unfinished_but_not_switched_on(session, world):
    emp, qa = await employer_with_skill(world)
    job = await create(session, emp, **GOOD, required_tag_ids=[qa])
    await employers_router.toggle_job_active(job_id=job["id"], user=boss(emp), session=session)  # off
    draft = await employers_router.update_job(job_id=job["id"], body=JobPostingUpdate(description="Short"),
                                              user=boss(emp), session=session)
    assert draft["active"] is False
    assert [i["code"] for i in draft["issues"] if i["level"] == "must"] == ["description"]
    with pytest.raises(HTTPException) as e:
        await employers_router.toggle_job_active(job_id=job["id"], user=boss(emp), session=session)
    assert e.value.status_code == 422
    assert "a description" in e.value.detail


async def test_the_job_list_marks_what_each_job_is_missing(session, world):
    emp, qa = await employer_with_skill(world)
    await create(session, emp, **GOOD, required_tag_ids=[qa])
    await world.job(emp, title="Old job without a description")  # e.g. posted before the check existed
    await world.commit()
    jobs = {j["title"]: j for j in await employers_router.list_my_jobs(user=boss(emp), session=session)}
    assert jobs["Junior QA Engineer"]["issues"] == []
    missing = [i["code"] for i in jobs["Old job without a description"]["issues"] if i["level"] == "must"]
    assert missing == ["description", "location", "skills"]


# --- "Fill with AI" and files --------------------------------------------------------

class AIReads:
    def __init__(self, kind="job_post"):
        self.kind = kind

    async def extract_job_profile(self, text, taxonomy):
        return JobProfile(title="Something", kind=self.kind)


@pytest.fixture
def no_quota(monkeypatch):
    async def free(user_id, units):
        return None
    monkeypatch.setattr(cv_router, "consume_llm_units", free)


async def read_text(session, emp, monkeypatch, kind):
    monkeypatch.setattr(cv_router, "get_llm_provider", lambda: AIReads(kind))
    return await cv_router.parse_job_text_route.__wrapped__(
        request=None, payload=ParseJobTextRequest(text="Dana Levi. 5 years of Python at Wix. Education: BSc..."),
        user=boss(emp), session=session,
    )


async def test_fill_with_ai_refuses_a_cv(session, world, monkeypatch, no_quota):
    emp, _ = await employer_with_skill(world)
    with pytest.raises(HTTPException) as e:
        await read_text(session, emp, monkeypatch, "cv")
    assert e.value.status_code == 422
    assert "looks like a CV" in e.value.detail


async def test_fill_with_ai_refuses_text_that_is_not_a_job_post(session, world, monkeypatch, no_quota):
    emp, _ = await employer_with_skill(world)
    with pytest.raises(HTTPException) as e:
        await read_text(session, emp, monkeypatch, "other")
    assert e.value.status_code == 422
    assert "doesn't look like a job post" in e.value.detail


async def test_fill_with_ai_reads_a_job_post(session, world, monkeypatch, no_quota):
    emp, _ = await employer_with_skill(world)
    assert (await read_text(session, emp, monkeypatch, "job_post"))["title"] == "Something"


async def parse_files(session, emp, monkeypatch, files, kind="job_post"):
    monkeypatch.setattr(cv_router, "get_llm_provider", lambda: AIReads(kind))
    uploads = [UploadFile(filename=name, file=BytesIO(data), headers={"content-type": "text/plain"})
               for name, data in files]
    return (await cv_router.parse_job_files.__wrapped__(request=None, files=uploads, user=boss(emp), session=session))["parsed"]


async def test_a_cv_uploaded_as_a_job_file_is_flagged(session, world, monkeypatch, no_quota):
    emp, _ = await employer_with_skill(world)
    [result] = await parse_files(session, emp, monkeypatch, [("my-cv.txt", b"Dana Levi, QA engineer, 5 years experience...")], "cv")
    assert "looks like a CV" in result["error"]
    assert "title" not in result


async def test_an_empty_or_scanned_file_says_there_is_no_text(session, world, monkeypatch, no_quota):
    emp, _ = await employer_with_skill(world)
    [result] = await parse_files(session, emp, monkeypatch, [("scan.txt", b"   \n  ")])
    assert "couldn't find any text" in result["error"]


# --- Comeet ----------------------------------------------------------------------------

class TagsOnlySometimes:
    """Reads the jobs; tags them only from the second time on (e.g. the AI was paused)."""

    def __init__(self, tag: bool):
        self.tag = tag

    async def extract_job_profile(self, text, taxonomy):
        return JobProfile(required_tags=["Java"] if self.tag else [])


async def test_comeet_jobs_missing_something_come_in_off_and_go_live_once_complete(session, world, monkeypatch):
    emp = await world.employer("Careers API Sandbox")
    await world.tag("Java")
    await give_pro(world, emp)
    await connect(session, emp, monkeypatch)
    conn = await the_connection(session, emp)
    positions = json.loads((Path(__file__).parent.parent / "fixtures" / "comeet_positions.json").read_text())

    await ats_sync.sync_connection(session, conn, fetch=comeet_returns(positions), provider=TagsOnlySometimes(False))
    jobs = await comeet_jobs(session, emp)
    assert not any(j.active for j in jobs.values())        # no skills yet: held back
    assert all(j.held_reason == "incomplete" for j in jobs.values())

    changed = copy.deepcopy(positions)
    for p in changed:
        p["time_updated"] = "2026-11-27T10:00:00Z"
    await ats_sync.sync_connection(session, conn, fetch=comeet_returns(changed), provider=TagsOnlySometimes(True))
    jobs = await comeet_jobs(session, emp)
    assert all(j.active for j in jobs.values())             # complete now: live by themselves
    assert all(j.held_reason is None for j in jobs.values())


async def test_switching_a_held_job_on_by_hand_still_needs_it_complete(session, world, monkeypatch):
    emp = await world.employer("Careers API Sandbox")
    await give_pro(world, emp)
    await connect(session, emp, monkeypatch)
    conn = await the_connection(session, emp)
    positions = json.loads((Path(__file__).parent.parent / "fixtures" / "comeet_positions.json").read_text())
    await ats_sync.sync_connection(session, conn, fetch=comeet_returns(positions), provider=TagsOnlySometimes(False))
    job = next(iter((await comeet_jobs(session, emp)).values()))
    with pytest.raises(HTTPException) as e:
        await employers_router.toggle_job_active(job_id=str(job.id), user=boss(emp), session=session)
    assert e.value.status_code == 422
    assert "at least one skill" in e.value.detail
    assert isinstance(job, JobPosting)
