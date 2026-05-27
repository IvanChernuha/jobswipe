"""GDPR compliance: data export and account deletion."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.client import get_auth_client
from app.db.session import get_session
from app.models.tables.user import User
from app.models.tables.worker import WorkerProfile, WorkerTag
from app.models.tables.employer import EmployerProfile
from app.models.tables.job import JobPosting, JobPostingTag
from app.models.tables.tag import Tag
from app.models.tables.swipe import Swipe
from app.models.tables.match import Match
from app.models.tables.message import Message, MessageReadCursor
from app.models.tables.bookmark import Bookmark
from app.models.tables.report import Report
from app.models.tables.organization import OrgMember

router = APIRouter(prefix="/account", tags=["gdpr"])


@router.get("/export")
async def export_my_data(user: dict = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Download all personal data (GDPR Article 15)."""
    uid = uuid.UUID(user["id"])
    role = user["role"]

    u = await session.get(User, uid)

    if role == "worker":
        profile = await session.get(WorkerProfile, uid)
        tr = await session.execute(
            select(Tag.id, Tag.name, Tag.category)
            .join(WorkerTag, WorkerTag.tag_id == Tag.id)
            .where(WorkerTag.worker_id == uid)
        )
        tags = [{"id": str(r.id), "name": r.name, "category": r.category} for r in tr.all()]
    else:
        profile = await session.get(EmployerProfile, uid)
        tags = None

    # Job postings (employers)
    jobs = []
    if role == "employer":
        jr = await session.execute(select(JobPosting).where(JobPosting.employer_id == uid))
        for j in jr.scalars().all():
            jtr = await session.execute(
                select(JobPostingTag.requirement, Tag.id, Tag.name, Tag.category)
                .join(Tag, Tag.id == JobPostingTag.tag_id)
                .where(JobPostingTag.job_posting_id == j.id)
            )
            jtags = [{"id": str(r.id), "name": r.name, "category": r.category, "requirement": r.requirement} for r in jtr.all()]
            jobs.append({
                "id": str(j.id), "title": j.title, "description": j.description,
                "salary_min": j.salary_min, "salary_max": j.salary_max,
                "location": j.location, "remote": j.remote, "active": j.active,
                "created_at": str(j.created_at), "tags": jtags,
            })

    # Swipes
    sr = await session.execute(
        select(Swipe.target_id, Swipe.direction, Swipe.created_at)
        .where(Swipe.swiper_id == uid).order_by(Swipe.created_at.desc())
    )
    swipes = [{"target_id": str(r.target_id), "direction": r.direction, "created_at": str(r.created_at)} for r in sr.all()]

    # Matches
    if role == "worker":
        mr = await session.execute(select(Match).where(Match.worker_id == uid))
    else:
        mr = await session.execute(select(Match).where(Match.employer_id == uid))
    matches = [{
        "id": str(m.id), "worker_id": str(m.worker_id), "employer_id": str(m.employer_id),
        "job_posting_id": str(m.job_posting_id) if m.job_posting_id else None,
        "status": m.status, "matched_at": str(m.matched_at),
    } for m in mr.scalars().all()]

    # Messages sent
    msgr = await session.execute(
        select(Message).where(Message.sender_id == uid).order_by(Message.created_at.desc())
    )
    messages = [{"match_id": str(m.match_id), "body": m.body, "created_at": str(m.created_at)} for m in msgr.scalars().all()]

    # Bookmarks
    br = await session.execute(select(Bookmark).where(Bookmark.user_id == uid))
    bookmarks = [{"target_id": str(b.target_id), "note": b.note, "created_at": str(b.created_at)} for b in br.scalars().all()]

    # Reports
    rr = await session.execute(select(Report).where(Report.reporter_id == uid))
    reports = [{
        "target_id": str(r.target_id), "target_type": r.target_type,
        "reason": r.reason, "details": r.details, "created_at": str(r.created_at),
    } for r in rr.scalars().all()]

    # Org
    omr = await session.execute(select(OrgMember).where(OrgMember.user_id == uid))
    org_memberships = [{"org_id": str(o.org_id), "role": o.role, "created_at": str(o.created_at)} for o in omr.scalars().all()]

    profile_data = None
    if profile:
        profile_data = {k: v for k, v in profile.__dict__.items() if not k.startswith("_")}
        for k in ("user_id", "org_id"):
            if k in profile_data and profile_data[k]:
                profile_data[k] = str(profile_data[k])
        profile_data.pop("embedding", None)

    user_data = {"id": str(u.id), "email": u.email, "role": u.role, "created_at": str(u.created_at)} if u else None

    return {
        "user": user_data,
        "profile": profile_data,
        "tags": tags,
        "job_postings": jobs,
        "swipes": swipes,
        "matches": matches,
        "messages_sent": messages,
        "bookmarks": bookmarks,
        "reports_filed": reports,
        "org_memberships": org_memberships,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/delete", status_code=200)
async def delete_my_account(user: dict = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Permanently delete account and all data (GDPR Article 17)."""
    auth_db = get_auth_client()
    uid = uuid.UUID(user["id"])

    # Delete in FK-dependent order
    await session.execute(delete(Message).where(Message.sender_id == uid))
    await session.execute(delete(Bookmark).where(Bookmark.user_id == uid))
    await session.execute(delete(Report).where(Report.reporter_id == uid))
    await session.execute(delete(OrgMember).where(OrgMember.user_id == uid))
    await session.execute(delete(MessageReadCursor).where(MessageReadCursor.user_id == uid))
    await session.execute(delete(Match).where(Match.worker_id == uid))
    await session.execute(delete(Match).where(Match.employer_id == uid))
    await session.execute(delete(Swipe).where(Swipe.swiper_id == uid))
    await session.execute(delete(Swipe).where(Swipe.target_id == uid))
    await session.execute(delete(JobPosting).where(JobPosting.employer_id == uid))
    await session.execute(delete(WorkerTag).where(WorkerTag.worker_id == uid))
    await session.execute(delete(WorkerProfile).where(WorkerProfile.user_id == uid))
    await session.execute(delete(EmployerProfile).where(EmployerProfile.user_id == uid))
    await session.execute(delete(User).where(User.id == uid))
    await session.commit()

    # Delete from Supabase Auth
    try:
        auth_db.auth.admin.delete_user(user["id"])
    except Exception:
        pass

    return {"deleted": True, "user_id": user["id"]}
