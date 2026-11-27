"""Hiring-system integrations: import jobs from Comeet (OpenProject #3297).

One paste of the company's UID + Token, then everything is automatic: the
import runs in the background and later syncs keep the jobs current (rules in
services/ats_sync.py, plan in docs/worklog/comeet-import.md). Pro only.
The token is never returned by any endpoint.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.deps import require_employer_with_permission
from app.models.tables.ats import AtsConnection
from app.models.tables.job import JobPosting
from app.services.ats_sync import is_stale, mark_importing, run_sync
from app.services.comeet import ComeetError, fetch_positions, parse_credentials
from app.services.org_access import get_org_employer_ids
from app.services.plans import billing_subject, pro_status

router = APIRouter(prefix="/integrations", tags=["integrations"])

PROVIDER = "comeet"
NEEDS_PRO = "Importing jobs from Comeet is part of Pro. Redeem a Pro code (Profile → Plan)."
NEEDS_BOTH = ("Paste both the UID and the Token from Comeet "
              "(Company Settings → Careers Website).")


class ComeetConnectRequest(BaseModel):
    text: str = Field(max_length=2000)


async def _assert_pro(session: AsyncSession, user_id: str) -> None:
    subject_type, subject_id, _ = await billing_subject(session, user_id)
    is_pro, _ = await pro_status(session, subject_type, subject_id)
    if not is_pro:
        raise HTTPException(402, NEEDS_PRO)


async def _team_connection(session: AsyncSession, user_id: str) -> AtsConnection | None:
    """The Comeet connection of this employer or anyone on their team."""
    ids = [uuid.UUID(i) for i in await get_org_employer_ids(session, user_id)] or [uuid.UUID(user_id)]
    return (await session.execute(
        select(AtsConnection).where(AtsConnection.employer_id.in_(ids), AtsConnection.provider == PROVIDER)
        .order_by(AtsConnection.created_at.desc()).limit(1)
    )).scalars().first()


@router.post("/comeet")
async def connect_comeet(
    body: ComeetConnectRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_employer_with_permission("create_job")),
    session: AsyncSession = Depends(get_session),
):
    """Connect Comeet with one paste, check it works, and start the import."""
    await _assert_pro(session, user["id"])
    credentials = parse_credentials(body.text)
    if not credentials:
        raise HTTPException(400, NEEDS_BOTH)
    uid, token = credentials
    try:
        positions = await fetch_positions(uid, token)
    except ComeetError as e:
        raise HTTPException(400, str(e))
    company = next((p.get("company_name") for p in positions if p.get("company_name")), "") or ""

    employer_id = uuid.UUID(user["id"])
    conn = (await session.execute(
        select(AtsConnection).where(AtsConnection.employer_id == employer_id, AtsConnection.provider == PROVIDER)
    )).scalars().first()
    if conn is None:
        conn = AtsConnection(employer_id=employer_id, provider=PROVIDER, company_uid=uid, token=token,
                             created_at=datetime.now(timezone.utc))
        session.add(conn)
    conn.company_uid, conn.token, conn.company_name = uid, token, company
    mark_importing(conn)
    conn.last_error = None
    await session.commit()

    background_tasks.add_task(run_sync, conn.id)
    return {"company_name": company, "found": len(positions), "status": "importing"}


@router.get("/comeet")
async def comeet_status(
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_employer_with_permission("view")),
    session: AsyncSession = Depends(get_session),
):
    """Is Comeet connected, how many jobs came from it, when it last synced.
    Opening this more than a day after the last sync starts a new one."""
    conn = await _team_connection(session, user["id"])
    if conn is None:
        return {"connected": False}
    if is_stale(conn):
        mark_importing(conn)
        await session.commit()
        background_tasks.add_task(run_sync, conn.id)
    from_comeet = (JobPosting.employer_id == conn.employer_id) & (JobPosting.source == PROVIDER)
    job_count = await session.scalar(select(func.count()).select_from(JobPosting).where(from_comeet)) or 0
    live_count = await session.scalar(
        select(func.count()).select_from(JobPosting).where(from_comeet, JobPosting.active == True)  # noqa: E712
    ) or 0
    return {
        "connected": True,
        "company_name": conn.company_name,
        "status": conn.status,
        "job_count": int(job_count),
        "live_count": int(live_count),
        "last_synced_at": conn.last_synced_at.isoformat() if conn.last_synced_at else None,
        "last_error": conn.last_error,
    }


@router.post("/comeet/sync")
async def sync_comeet_now(
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_employer_with_permission("create_job")),
    session: AsyncSession = Depends(get_session),
):
    conn = await _team_connection(session, user["id"])
    if conn is None:
        raise HTTPException(404, "Comeet isn't connected")
    if conn.status != "importing" or is_stale(conn):
        mark_importing(conn)
        await session.commit()
        background_tasks.add_task(run_sync, conn.id)
    return {"status": "importing"}


@router.delete("/comeet")
async def disconnect_comeet(
    user: dict = Depends(require_employer_with_permission("create_job")),
    session: AsyncSession = Depends(get_session),
):
    """Stop syncing: the stored token is deleted and the imported jobs are
    switched off (they would go out of date). Jobs posted by hand stay as they are."""
    conn = await _team_connection(session, user["id"])
    if conn is None:
        return {"disconnected": True, "jobs_switched_off": 0}
    result = await session.execute(
        update(JobPosting)
        .where(JobPosting.employer_id == conn.employer_id, JobPosting.source == PROVIDER,
               JobPosting.active == True)  # noqa: E712
        .values(active=False, updated_at=datetime.now(timezone.utc))
    )
    await session.delete(conn)
    await session.commit()
    return {"disconnected": True, "jobs_switched_off": result.rowcount or 0}
