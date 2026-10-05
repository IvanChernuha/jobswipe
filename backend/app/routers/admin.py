"""Admin endpoints backing the /admin page: moderation + liquidity metrics.

Gated by ADMIN_EMAILS. Moderation exists so a false positive from the
automated report loop is a one-click undo, not a database session.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_current_user, require_admin, _admin_emails
from app.db.session import get_session
from app.models.tables.employer import EmployerProfile
from app.models.tables.job import JobPosting
from app.models.tables.report import Report
from app.models.tables.user import User
from app.models.tables.worker import WorkerProfile
from app.services.moderation import apply_action

router = APIRouter(prefix="/admin", tags=["admin"])


class ReportRow(BaseModel):
    id: str
    reporter_id: str
    target_id: str
    target_type: str
    reason: str
    details: str
    status: str
    created_at: Optional[str] = None
    actioned_at: Optional[str] = None
    reporter_email: str = ""
    target_label: str = ""
    target_detail: str = ""
    target_reports: int = 0


class ActionNote(BaseModel):
    note: str = ""


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(400, "Invalid id")


@router.get("/am-i")
async def am_i_admin(user: dict = Depends(get_current_user)):
    """Lets the frontend decide whether to show the Admin link, without a 403 for everyone else."""
    return {"admin": (user.get("email") or "").strip().lower() in _admin_emails()}


@router.get("/moderation/status")
async def moderation_status(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    pending = await session.scalar(select(func.count()).select_from(Report).where(Report.status == "pending"))
    suspended = await session.scalar(select(func.count()).select_from(User).where(User.suspended_at.is_not(None)))
    hidden = await session.scalar(
        select(func.count()).select_from(JobPosting).where(JobPosting.moderation_note.is_not(None), JobPosting.active == False)
    )
    return {
        "auto_actions": settings.MODERATION_AUTO_ACTIONS,
        "threshold": settings.REPORT_AUTO_ACTION_THRESHOLD,
        "image_moderation": settings.IMAGE_MODERATION,
        "pending_reports": pending or 0,
        "suspended_users": suspended or 0,
        "hidden_jobs": hidden or 0,
    }


@router.get("/reports", response_model=list[ReportRow])
async def list_reports(
    status: str = Query("pending"),
    limit: int = Query(100, ge=1, le=500),
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Report).where(Report.status == status).order_by(Report.created_at.desc()).limit(limit)
    )
    reports = result.scalars().all()
    if not reports:
        return []

    user_ids = {r.reporter_id for r in reports} | {r.target_id for r in reports if r.target_type == "user"}
    job_ids = {r.target_id for r in reports if r.target_type == "job"}

    emails = {u.id: u.email for u in (await session.execute(select(User.id, User.email).where(User.id.in_(user_ids)))).all()}
    names = {w.user_id: w.name for w in (await session.execute(
        select(WorkerProfile.user_id, WorkerProfile.name).where(WorkerProfile.user_id.in_(user_ids)))).all()}
    names.update({e.user_id: e.company_name for e in (await session.execute(
        select(EmployerProfile.user_id, EmployerProfile.company_name).where(EmployerProfile.user_id.in_(user_ids)))).all()})
    jobs = {j.id: j for j in (await session.execute(select(JobPosting).where(JobPosting.id.in_(job_ids)))).scalars().all()} if job_ids else {}

    counts = {(c.target_type, c.target_id): c.n for c in (await session.execute(
        select(Report.target_type, Report.target_id, func.count().label("n"))
        .where(Report.target_id.in_({r.target_id for r in reports}))
        .group_by(Report.target_type, Report.target_id))).all()}

    out = []
    for r in reports:
        if r.target_type == "job":
            job = jobs.get(r.target_id)
            label = job.title if job else "(deleted job)"
            detail = (emails.get(job.employer_id, "") if job else "")
            if job and not job.active:
                detail = f"{detail} · hidden" if detail else "hidden"
        else:
            label = names.get(r.target_id) or emails.get(r.target_id) or "(deleted user)"
            detail = emails.get(r.target_id, "")
        out.append({
            "id": str(r.id), "reporter_id": str(r.reporter_id), "target_id": str(r.target_id),
            "target_type": r.target_type, "reason": r.reason, "details": r.details or "",
            "status": r.status,
            "created_at": str(r.created_at) if r.created_at else None,
            "actioned_at": str(r.actioned_at) if r.actioned_at else None,
            "reporter_email": emails.get(r.reporter_id, ""),
            "target_label": label, "target_detail": detail,
            "target_reports": counts.get((r.target_type, r.target_id), 1),
        })
    return out


@router.get("/users/suspended")
async def list_suspended(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(User).where(User.suspended_at.is_not(None)).order_by(User.suspended_at.desc())
    )).scalars().all()
    return [
        {"id": str(u.id), "email": u.email, "role": u.role,
         "suspended_at": str(u.suspended_at), "reason": u.suspended_reason or ""}
        for u in rows
    ]


@router.get("/jobs/hidden")
async def list_hidden(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(JobPosting, User.email).join(User, User.id == JobPosting.employer_id)
        .where(JobPosting.moderation_note.is_not(None), JobPosting.active == False)  # noqa: E712
    )).all()
    return [
        {"id": str(j.id), "title": j.title, "employer_email": email, "note": j.moderation_note or ""}
        for j, email in rows
    ]


def _exclude_clause(include_test: bool) -> tuple[str, dict]:
    """SQL fragment (for alias u) dropping test/demo accounts, plus its bind params."""
    if include_test:
        return "TRUE", {}
    patterns = [p.strip() for p in settings.ANALYTICS_EXCLUDE_EMAILS.split(",") if p.strip()]
    if not patterns:
        return "TRUE", {}
    params = {f"p{i}": p for i, p in enumerate(patterns)}
    return " AND ".join(f"u.email NOT LIKE :p{i}" for i in range(len(patterns))), params


@router.get("/liquidity")
async def liquidity(
    days: int = Query(30, ge=7, le=180),
    include_test: bool = Query(False),
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Is the marketplace working? Signups, supply, and how fast new users get to a match and a conversation."""
    real, params = _exclude_clause(include_test)
    params["days"] = days

    # "real" users (test accounts filtered) — every metric is built on this set.
    cte = f"""
      WITH real_users AS (SELECT u.id, u.role, u.created_at FROM users u WHERE {real}),
      cohort AS (SELECT * FROM real_users WHERE created_at >= now() - make_interval(days => :days)),
      user_matches AS (
        SELECT m.id, m.matched_at, m.worker_id AS uid FROM matches m
        UNION ALL
        SELECT m.id, m.matched_at, m.employer_id AS uid FROM matches m
      ),
      first_match AS (
        SELECT c.id, c.role, c.created_at, min(um.matched_at) AS first_at
        FROM cohort c LEFT JOIN user_matches um ON um.uid = c.id AND um.matched_at >= c.created_at
        GROUP BY c.id, c.role, c.created_at
      )
    """

    totals = (await session.execute(text(cte + """
      SELECT
        (SELECT count(*) FROM real_users WHERE role = 'worker')   AS workers,
        (SELECT count(*) FROM real_users WHERE role = 'employer') AS employers,
        (SELECT count(*) FROM cohort) AS new_users,
        (SELECT count(DISTINCT j.employer_id) FROM job_postings j JOIN real_users r ON r.id = j.employer_id
           WHERE j.active AND j.expires_at > now()) AS employers_live,
        (SELECT count(*) FROM job_postings j JOIN real_users r ON r.id = j.employer_id
           WHERE j.active AND j.expires_at > now()) AS live_jobs,
        (SELECT count(*) FROM first_match WHERE first_at IS NOT NULL AND first_at <= created_at + interval '7 days') AS matched_7d,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_at - created_at) / 3600.0)
           FROM first_match WHERE first_at IS NOT NULL) AS median_hours_to_match
    """), params)).mappings().one()

    conv = (await session.execute(text(cte + """
      , window_matches AS (
        SELECT m.id, m.worker_id, m.employer_id FROM matches m
        JOIN real_users rw ON rw.id = m.worker_id
        JOIN real_users re ON re.id = m.employer_id
        WHERE m.matched_at >= now() - make_interval(days => :days)
      )
      SELECT
        (SELECT count(*) FROM window_matches) AS matches,
        (SELECT count(*) FROM window_matches w WHERE EXISTS (SELECT 1 FROM messages x WHERE x.match_id = w.id)) AS with_message,
        (SELECT count(*) FROM window_matches w
           WHERE EXISTS (SELECT 1 FROM messages x WHERE x.match_id = w.id AND x.sender_id = w.worker_id)
             AND EXISTS (SELECT 1 FROM messages x WHERE x.match_id = w.id AND x.sender_id <> w.worker_id)) AS two_way
    """), params)).mappings().one()

    daily = (await session.execute(text(f"""
      WITH real_users AS (SELECT u.id, u.role, u.created_at FROM users u WHERE {real}),
      days AS (SELECT generate_series(current_date - (:days - 1), current_date, interval '1 day')::date AS d)
      SELECT d.d AS day,
        count(r.id) FILTER (WHERE r.role = 'worker')   AS workers,
        count(r.id) FILTER (WHERE r.role = 'employer') AS employers,
        (SELECT count(*) FROM matches m
           JOIN real_users rw ON rw.id = m.worker_id JOIN real_users re ON re.id = m.employer_id
           WHERE m.matched_at::date = d.d) AS matches
      FROM days d LEFT JOIN real_users r ON r.created_at::date = d.d
      GROUP BY d.d ORDER BY d.d
    """), params)).mappings().all()

    def pct(n, d):
        return round(100.0 * n / d, 1) if d else None

    median = totals["median_hours_to_match"]
    return {
        "days": days,
        "include_test": include_test,
        "totals": {
            "workers": totals["workers"], "employers": totals["employers"],
            "new_users": totals["new_users"],
            "employers_with_live_jobs": totals["employers_live"], "live_jobs": totals["live_jobs"],
        },
        "activation": {
            "new_users": totals["new_users"],
            "matched_within_7d": totals["matched_7d"],
            "pct_matched_within_7d": pct(totals["matched_7d"], totals["new_users"]),
            "median_hours_to_first_match": round(float(median), 1) if median is not None else None,
        },
        "conversations": {
            "matches": conv["matches"],
            "with_first_message": conv["with_message"],
            "pct_with_first_message": pct(conv["with_message"], conv["matches"]),
            "two_way": conv["two_way"],
            "pct_two_way": pct(conv["two_way"], conv["matches"]),
        },
        "daily": [
            {"day": str(r["day"]), "workers": r["workers"], "employers": r["employers"], "matches": r["matches"]}
            for r in daily
        ],
    }


@router.post("/reports/{report_id}/dismiss")
async def dismiss_report(report_id: str, user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    report = await session.get(Report, _uuid(report_id))
    if not report:
        raise HTTPException(404, "Report not found")
    report.status = "dismissed"
    session.add(report)
    await session.commit()
    return {"id": report_id, "status": "dismissed"}


@router.post("/reports/{report_id}/action")
async def action_report(
    report_id: str, body: ActionNote,
    user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session),
):
    """Hide the job / suspend the user this report targets, regardless of the threshold."""
    report = await session.get(Report, _uuid(report_id))
    if not report:
        raise HTTPException(404, "Report not found")
    changed = await apply_action(session, report.target_type, report.target_id, body.note or f"manual by {user['email']}")
    if not changed:
        raise HTTPException(404, "Report target no longer exists")
    return {"id": report_id, "target_type": report.target_type, "target_id": str(report.target_id), "actioned": True}


@router.post("/users/{user_id}/unsuspend")
async def unsuspend_user(user_id: str, user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    target = await session.get(User, _uuid(user_id))
    if not target:
        raise HTTPException(404, "User not found")
    target.suspended_at = None
    target.suspended_reason = None
    session.add(target)
    await session.commit()
    return {"id": user_id, "suspended": False}


@router.post("/jobs/{job_id}/unhide")
async def unhide_job(job_id: str, user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    job = await session.get(JobPosting, _uuid(job_id))
    if not job:
        raise HTTPException(404, "Job not found")
    job.active = True
    job.moderation_note = None
    session.add(job)
    await session.commit()
    return {"id": job_id, "active": True}
