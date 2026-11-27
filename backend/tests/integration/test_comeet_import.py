"""Comeet import with a real database (OpenProject #3297; plan
docs/worklog/comeet-import.md).

The user (2026-11-26): employers on Comeet should bring their jobs in
"brain-dead, just tap and go". One paste of the UID + Token, then everything
is automatic: all published jobs come in live and AI-tagged, and later syncs
add new ones, update changed ones, and switch off the ones closed in Comeet.
Comeet itself and the AI are fakes here; the positions are real sandbox data.
"""
import copy
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select

from app.models.tables import ProGrant
from app.models.tables.ats import AtsConnection
from app.models.tables.job import JobPosting, JobPostingTag
from app.routers import integrations
from app.services import ats_sync
from app.services.comeet import ComeetError
from app.services.llm.ai_budget import AIBudgetExceeded
from app.services.llm.base import JobProfile

pytestmark = pytest.mark.asyncio

POSITIONS = json.loads((Path(__file__).parent.parent / "fixtures" / "comeet_positions.json").read_text())
TOKEN = "5E7236A0BCE5E7295111B55E70BCE"
PASTE = f"UID: E5.007\nToken: {TOKEN}"


class FakeAI:
    """Reads every job as needing Java, preferring Android, nice to have Python."""

    def __init__(self, fail_with: Exception | None = None):
        self.calls: list[str] = []
        self.fail_with = fail_with

    async def extract_job_profile(self, text, taxonomy):
        self.calls.append(text)
        if self.fail_with:
            raise self.fail_with
        return JobProfile(required_tags=["Java"], preferred_tags=["Android"], nice_tags=["Python"],
                          min_experience_years=1)


def comeet_returns(positions):
    async def fetch(uid, token, client=None):
        assert (uid, token) == ("E5.007", TOKEN)
        return copy.deepcopy(positions)
    return fetch


def comeet_fails(message="Comeet isn't answering right now. Please try again in a few minutes."):
    async def fetch(uid, token, client=None):
        raise ComeetError(message)
    return fetch


async def give_pro(world, user_id):
    world.s.add(ProGrant(subject_type="user", subject_id=user_id, source="admin",
                         starts_at=datetime.now(timezone.utc) - timedelta(days=1)))
    await world.commit()


async def pro_employer(world):
    emp = await world.employer("Careers API Sandbox")
    for name in ("Java", "Android", "Python"):
        await world.tag(name)
    await give_pro(world, emp)
    return emp


def user(emp):
    return {"id": str(emp), "role": "employer", "email": "hr@startup.test"}


async def connect(session, emp, monkeypatch, text=PASTE, positions=POSITIONS):
    monkeypatch.setattr(integrations, "fetch_positions", comeet_returns(positions))
    tasks = BackgroundTasks()
    out = await integrations.connect_comeet(
        body=integrations.ComeetConnectRequest(text=text), background_tasks=tasks, user=user(emp), session=session,
    )
    return out, tasks


async def the_connection(session, emp) -> AtsConnection:
    return (await session.execute(select(AtsConnection).where(AtsConnection.employer_id == emp))).scalars().one()


async def sync(session, emp, positions=POSITIONS, ai=None):
    conn = await the_connection(session, emp)
    return await ats_sync.sync_connection(session, conn, fetch=comeet_returns(positions), provider=ai or FakeAI())


async def comeet_jobs(session, emp) -> dict[str, JobPosting]:
    rows = (await session.execute(
        select(JobPosting).where(JobPosting.employer_id == emp, JobPosting.source == "comeet")
    )).scalars().all()
    for row in rows:
        await session.refresh(row)
    return {j.source_id: j for j in rows}


async def tag_levels(session, job_id) -> dict[str, int]:
    rows = (await session.execute(
        select(JobPostingTag.requirement).where(JobPostingTag.job_posting_id == job_id)
    )).scalars().all()
    return {level: rows.count(level) for level in set(rows)}


# --- connecting: one paste ------------------------------------------------------

async def test_connecting_checks_the_paste_and_starts_the_import(session, world, monkeypatch):
    emp = await pro_employer(world)
    out, tasks = await connect(session, emp, monkeypatch)
    assert out == {"company_name": "Careers API Sandbox", "found": 3, "status": "importing"}
    assert len(tasks.tasks) == 1  # the import runs in the background
    conn = await the_connection(session, emp)
    assert (conn.provider, conn.company_uid, conn.token, conn.status) == ("comeet", "E5.007", TOKEN, "importing")


async def test_wrong_credentials_are_refused_with_comeets_reason(session, world, monkeypatch):
    emp = await pro_employer(world)
    monkeypatch.setattr(integrations, "fetch_positions", comeet_fails("Comeet didn't accept this UID or Token."))
    with pytest.raises(HTTPException) as e:
        await integrations.connect_comeet(
            body=integrations.ComeetConnectRequest(text=PASTE), background_tasks=BackgroundTasks(),
            user=user(emp), session=session,
        )
    assert e.value.status_code == 400
    assert "UID or Token" in e.value.detail
    assert (await session.execute(select(AtsConnection))).scalars().all() == []


async def test_a_paste_without_both_values_says_what_is_missing(session, world, monkeypatch):
    emp = await pro_employer(world)
    with pytest.raises(HTTPException) as e:
        await connect(session, emp, monkeypatch, text="just some text")
    assert e.value.status_code == 400
    assert "UID" in e.value.detail and "Token" in e.value.detail


async def test_comeet_import_is_part_of_pro(session, world, monkeypatch):
    emp = await world.employer()
    await world.commit()
    with pytest.raises(HTTPException) as e:
        await connect(session, emp, monkeypatch)
    assert e.value.status_code == 402
    assert "Pro" in e.value.detail


async def test_connecting_again_replaces_the_old_credentials(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    await connect(session, emp, monkeypatch)
    assert len((await session.execute(select(AtsConnection))).scalars().all()) == 1


# --- the import -------------------------------------------------------------------

async def test_every_published_job_comes_in_live_and_tagged(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    result = await sync(session, emp)
    assert result == {"added": 3, "updated": 0, "closed": 0, "untagged": 0}

    jobs = await comeet_jobs(session, emp)
    android = jobs["E8.91F"]
    assert android.title == "Android Developer"
    assert android.active is True
    assert android.location == "Brooklyn, US"
    assert android.source_url.endswith("/android-developer/E8.91F")
    assert android.min_experience_years == 1   # the AI's reading beats "Entry-level"
    assert android.expires_at > datetime.now(timezone.utc) + timedelta(days=20)
    assert await tag_levels(session, android.id) == {"required": 1, "preferred": 1, "nice": 1}

    conn = await the_connection(session, emp)
    await session.refresh(conn)
    assert conn.status == "connected"
    assert conn.last_synced_at is not None
    assert conn.last_error is None


async def test_later_syncs_add_update_close_and_respect_the_employers_off_switch(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    await sync(session, emp)

    jobs = await comeet_jobs(session, emp)
    jobs["E8.91F"].expires_at = datetime.now(timezone.utc) + timedelta(days=2)
    ml_uid = POSITIONS[1]["uid"]
    jobs[ml_uid].active = False          # the employer switched this one off in JobSwipe
    await session.commit()

    changed = copy.deepcopy(POSITIONS)
    changed[0]["name"] = "Senior Android Developer"
    changed[0]["time_updated"] = "2026-11-20T10:00:00Z"
    gone = changed.pop(2)                # closed in Comeet
    changed.append({**copy.deepcopy(POSITIONS[0]), "uid": "NEW.001", "name": "QA Engineer",
                    "time_updated": "2026-11-25T09:00:00Z"})
    ai = FakeAI()
    result = await sync(session, emp, positions=changed, ai=ai)
    assert result == {"added": 1, "updated": 1, "closed": 1, "untagged": 0}
    assert len(ai.calls) == 2            # only the changed and the new job are re-read

    jobs = await comeet_jobs(session, emp)
    assert jobs["E8.91F"].title == "Senior Android Developer"
    assert jobs["E8.91F"].expires_at > datetime.now(timezone.utc) + timedelta(days=20)
    assert jobs[ml_uid].active is False  # still off: sync doesn't undo the employer's choice
    assert jobs[gone["uid"]].active is False
    assert jobs["NEW.001"].active is True


async def test_if_the_ai_cannot_read_them_jobs_still_come_in_and_are_read_next_time(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    result = await sync(session, emp, ai=FakeAI(fail_with=AIBudgetExceeded()))
    assert result["added"] == 3 and result["untagged"] == 3
    jobs = await comeet_jobs(session, emp)
    assert not any(j.active for j in jobs.values())   # no skills yet: held back (the job check)
    assert await tag_levels(session, jobs["E8.91F"].id) == {}

    ai = FakeAI()
    result = await sync(session, emp, ai=ai)
    assert len(ai.calls) == 3
    assert result == {"added": 0, "updated": 0, "closed": 0, "untagged": 0}  # read again, not a Comeet change
    jobs = await comeet_jobs(session, emp)
    assert await tag_levels(session, jobs["E8.91F"].id) == {"required": 1, "preferred": 1, "nice": 1}
    assert all(j.active for j in jobs.values())        # read now: live by themselves


async def test_without_pro_new_jobs_come_in_switched_off_beyond_the_free_limit(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    for grant in (await session.execute(select(ProGrant))).scalars().all():
        await session.delete(grant)      # Pro ran out
    await session.commit()
    await sync(session, emp)
    jobs = await comeet_jobs(session, emp)
    assert len(jobs) == 3
    assert sum(j.active for j in jobs.values()) == 1


async def test_when_comeet_is_down_the_jobs_stay_as_they_are(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    await sync(session, emp)
    conn = await the_connection(session, emp)
    result = await ats_sync.sync_connection(session, conn, fetch=comeet_fails(), provider=FakeAI())
    assert result is None
    await session.refresh(conn)
    assert conn.status == "error"
    assert "try again" in conn.last_error
    assert all(j.active for j in (await comeet_jobs(session, emp)).values())


async def test_the_daily_sync_does_every_connection(session, world, monkeypatch):
    first = await pro_employer(world)
    second = await world.employer("Other startup")
    await give_pro(world, second)
    await connect(session, first, monkeypatch)
    await connect(session, second, monkeypatch)
    done = await ats_sync.sync_all(session, fetch=comeet_returns(POSITIONS), provider=FakeAI())
    assert done == 2
    assert len(await comeet_jobs(session, first)) == 3
    assert len(await comeet_jobs(session, second)) == 3


# --- status and disconnect ----------------------------------------------------------

async def test_status_shows_the_connection_but_never_the_token(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    await sync(session, emp)
    tasks = BackgroundTasks()
    out = await integrations.comeet_status(background_tasks=tasks, user=user(emp), session=session)
    assert out["connected"] is True
    assert out["company_name"] == "Careers API Sandbox"
    assert out["status"] == "connected"
    assert (out["job_count"], out["live_count"]) == (3, 3)
    assert out["last_synced_at"] is not None
    assert TOKEN not in json.dumps(out, default=str)
    assert tasks.tasks == []             # synced just now: nothing to do


async def test_status_when_not_connected(session, world):
    emp = await pro_employer(world)
    out = await integrations.comeet_status(background_tasks=BackgroundTasks(), user=user(emp), session=session)
    assert out == {"connected": False}


async def test_opening_jobs_a_day_later_syncs_again(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    await sync(session, emp)
    conn = await the_connection(session, emp)
    conn.last_synced_at = datetime.now(timezone.utc) - timedelta(hours=30)
    await session.commit()
    tasks = BackgroundTasks()
    out = await integrations.comeet_status(background_tasks=tasks, user=user(emp), session=session)
    assert out["status"] == "importing"
    assert len(tasks.tasks) == 1


async def test_sync_now(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    await sync(session, emp)
    tasks = BackgroundTasks()
    out = await integrations.sync_comeet_now(background_tasks=tasks, user=user(emp), session=session)
    assert out == {"status": "importing"}
    assert len(tasks.tasks) == 1


async def test_sync_now_while_one_is_running_does_not_start_another(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)  # the import is still running
    tasks = BackgroundTasks()
    assert await integrations.sync_comeet_now(background_tasks=tasks, user=user(emp), session=session) == {"status": "importing"}
    assert tasks.tasks == []


async def test_an_import_stuck_for_over_an_hour_is_started_again(session, world, monkeypatch):
    emp = await pro_employer(world)
    await connect(session, emp, monkeypatch)
    conn = await the_connection(session, emp)
    conn.sync_started_at = datetime.now(timezone.utc) - timedelta(hours=2)  # died in a restart
    await session.commit()
    tasks = BackgroundTasks()
    await integrations.comeet_status(background_tasks=tasks, user=user(emp), session=session)
    assert len(tasks.tasks) == 1


async def test_disconnecting_switches_off_the_imported_jobs_only(session, world, monkeypatch):
    emp = await pro_employer(world)
    own = await world.job(emp, title="Posted by hand")
    await world.commit()
    await connect(session, emp, monkeypatch)
    await sync(session, emp)
    out = await integrations.disconnect_comeet(user=user(emp), session=session)
    assert out == {"disconnected": True, "jobs_switched_off": 3}
    assert (await session.execute(select(AtsConnection))).scalars().all() == []
    assert not any(j.active for j in (await comeet_jobs(session, emp)).values())
    assert (await session.get(JobPosting, own)).active is True
