"""Moving a match to another job (user request 2026-11-09).

Talking to a candidate, the employer may decide they fit a different job;
the match moves under that job, and the candidate is told.
"""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.match import MoveMatchRequest
from app.models.tables import EmployerProfile, Match, Notification, Organization, OrgMember
from app.routers.matches import get_match, move_match

pytestmark = pytest.mark.asyncio


async def setup(world):
    emp = await world.employer("Wix")
    frontend = await world.job(emp, title="Frontend")
    data = await world.job(emp, title="Data Analyst")
    worker = await world.worker([])
    mid = uuid.uuid4()
    world.s.add(Match(id=mid, worker_id=worker, employer_id=emp, job_posting_id=frontend,
                      status="active", matched_at=datetime.now(timezone.utc)))
    await world.commit()
    return emp, worker, mid, frontend, data


def as_employer(uid):
    return {"id": str(uid), "role": "employer"}


async def test_employer_moves_a_match_to_another_of_their_jobs(session, world):
    emp, worker, mid, _, data = await setup(world)

    out = await move_match(str(mid), MoveMatchRequest(job_posting_id=str(data)), user=as_employer(emp), session=session)

    assert out["job_posting_id"] == str(data)
    assert (await session.get(Match, mid)).job_posting_id == data


async def test_the_candidate_is_told(session, world):
    emp, worker, mid, _, data = await setup(world)

    await move_match(str(mid), MoveMatchRequest(job_posting_id=str(data)), user=as_employer(emp), session=session)

    notes = (await session.execute(select(Notification).where(Notification.user_id == worker))).scalars().all()
    assert [(n.type, n.title_key, n.params, n.link) for n in notes] == [
        ("match", "notif.match.moved", {"name": "Wix", "title": "Data Analyst"}, f"/chat/{mid}"),
    ]


async def test_moving_to_the_same_job_changes_nothing_and_tells_no_one(session, world):
    emp, worker, mid, frontend, _ = await setup(world)

    await move_match(str(mid), MoveMatchRequest(job_posting_id=str(frontend)), user=as_employer(emp), session=session)

    notes = (await session.execute(select(Notification).where(Notification.user_id == worker))).scalars().all()
    assert notes == []


async def test_only_to_your_own_jobs(session, world):
    emp, worker, mid, _, _ = await setup(world)
    other = await world.employer("Other")
    theirs = await world.job(other, title="Theirs")
    await world.commit()

    with pytest.raises(HTTPException) as e:
        await move_match(str(mid), MoveMatchRequest(job_posting_id=str(theirs)), user=as_employer(emp), session=session)
    assert e.value.status_code == 404


async def test_workers_and_strangers_cannot_move_it(session, world):
    emp, worker, mid, _, data = await setup(world)
    stranger = await world.employer("Stranger")
    await world.commit()
    body = MoveMatchRequest(job_posting_id=str(data))

    with pytest.raises(HTTPException) as e:
        await move_match(str(mid), body, user={"id": str(worker), "role": "worker"}, session=session)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await move_match(str(mid), body, user=as_employer(stranger), session=session)
    assert e.value.status_code == 403


async def test_team_viewers_cannot_move_it(session, world):
    emp, worker, mid, _, data = await setup(world)
    viewer = await world.user("employer")
    await world.s.flush()
    org_id = uuid.uuid4()
    session.add(Organization(id=org_id, name="Team", owner_id=emp))
    await world.s.flush()
    session.add(OrgMember(id=uuid.uuid4(), org_id=org_id, user_id=emp, role="owner"))
    session.add(OrgMember(id=uuid.uuid4(), org_id=org_id, user_id=viewer, role="viewer"))
    # Both profiles belong to the team, so the viewer can SEE the match...
    (await session.get(EmployerProfile, emp)).org_id = org_id
    session.add(EmployerProfile(user_id=viewer, company_name="Wix", org_id=org_id))
    await world.commit()
    out = await get_match(str(mid), user=as_employer(viewer), session=session)
    assert out["id"] == str(mid)
    # ...but a viewer can't change it.

    with pytest.raises(HTTPException) as e:
        await move_match(str(mid), MoveMatchRequest(job_posting_id=str(data)), user=as_employer(viewer), session=session)
    assert e.value.status_code == 403
