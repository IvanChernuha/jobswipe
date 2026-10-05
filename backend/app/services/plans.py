"""Free vs Pro for employers.

The plan belongs to the organization when the employer is in one (the whole
team shares it), otherwise to the solo employer. Pro comes from pro_grants
rows — today written only by promo-code redemption, later by billing too.
Free accounts may have FREE_LIVE_JOBS live jobs; Pro is unlimited.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables.job import JobPosting
from app.models.tables.organization import OrgMember
from app.models.tables.plan import PromoCode, ProGrant
from app.services.org_access import get_org_employer_ids

# No 0/O/1/I: codes get read aloud and typed from WhatsApp messages.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_code(length: int = 8) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


def normalize_code(code: str) -> str:
    return "".join(code.split()).upper()


async def billing_subject(session: AsyncSession, user_id: str) -> tuple[str, uuid.UUID, Optional[str]]:
    """('org', org_id, member_role) for org members, else ('user', user_id, None)."""
    uid = uuid.UUID(user_id)
    row = (await session.execute(
        select(OrgMember.org_id, OrgMember.role).where(OrgMember.user_id == uid).limit(1)
    )).first()
    if row:
        return "org", row.org_id, row.role
    return "user", uid, None


def pro_until_from(grants: list[tuple[datetime, Optional[datetime]]], now: datetime) -> tuple[bool, Optional[datetime]]:
    """(is_pro, ends_at) from (starts_at, ends_at) pairs. ends_at None with is_pro = forever."""
    active = [(s, e) for s, e in grants if s <= now and (e is None or e > now)]
    if not active:
        return False, None
    if any(e is None for _, e in active):
        return True, None
    return True, max(e for _, e in active)


async def pro_status(session: AsyncSession, subject_type: str, subject_id: uuid.UUID) -> tuple[bool, Optional[datetime]]:
    rows = (await session.execute(
        select(ProGrant.starts_at, ProGrant.ends_at)
        .where(ProGrant.subject_type == subject_type, ProGrant.subject_id == subject_id)
    )).all()
    return pro_until_from([(r.starts_at, r.ends_at) for r in rows], datetime.now(timezone.utc))


async def live_job_count(session: AsyncSession, user_id: str) -> int:
    employer_ids = [uuid.UUID(i) for i in await get_org_employer_ids(session, user_id)]
    if not employer_ids:
        return 0
    return int(await session.scalar(
        select(func.count()).select_from(JobPosting).where(
            JobPosting.employer_id.in_(employer_ids),
            JobPosting.active == True,  # noqa: E712
            JobPosting.expires_at > datetime.now(timezone.utc),
        )
    ) or 0)


async def plan_summary(session: AsyncSession, user_id: str) -> dict:
    subject_type, subject_id, role = await billing_subject(session, user_id)
    is_pro, until = await pro_status(session, subject_type, subject_id)
    return {
        "plan": "pro" if is_pro else "free",
        "pro_until": until.isoformat() if until else None,
        "shared_with_team": subject_type == "org",
        "can_redeem": role in (None, "owner", "admin"),
        "live_jobs": await live_job_count(session, user_id),
        "free_live_jobs": settings.FREE_LIVE_JOBS,
    }


async def assert_can_go_live(session: AsyncSession, user_id: str) -> None:
    """Raise 402 if making one more job live would exceed the Free plan."""
    subject_type, subject_id, _ = await billing_subject(session, user_id)
    is_pro, _ = await pro_status(session, subject_type, subject_id)
    if is_pro:
        return
    if await live_job_count(session, user_id) >= settings.FREE_LIVE_JOBS:
        raise HTTPException(
            402,
            f"The Free plan includes {settings.FREE_LIVE_JOBS} live job(s). "
            "Redeem a Pro code (Profile → Plan) or deactivate a job to post another.",
        )


async def redeem_code(session: AsyncSession, user_id: str, raw_code: str) -> dict:
    subject_type, subject_id, role = await billing_subject(session, user_id)
    if role not in (None, "owner", "admin"):
        raise HTTPException(403, "Only the organization's owner or an admin can redeem a code")

    code = normalize_code(raw_code)
    promo = (await session.execute(select(PromoCode).where(PromoCode.code == code))).scalars().first()
    now = datetime.now(timezone.utc)
    if not promo or not promo.active or (promo.redeem_by and promo.redeem_by < now):
        raise HTTPException(404, "This code is not valid")

    already = await session.scalar(select(func.count()).select_from(ProGrant).where(
        ProGrant.subject_type == subject_type, ProGrant.subject_id == subject_id, ProGrant.promo_code_id == promo.id))
    if already:
        raise HTTPException(409, "This code was already redeemed for your account")

    # Atomic: two people redeeming the last use at once can't both win.
    claimed = await session.execute(
        update(PromoCode)
        .where(PromoCode.id == promo.id, PromoCode.active == True, PromoCode.uses < PromoCode.max_uses)  # noqa: E712
        .values(uses=PromoCode.uses + 1)
        .returning(PromoCode.id)
    )
    if claimed.first() is None:
        await session.rollback()
        raise HTTPException(410, "This code has been fully used")

    # A new code extends existing Pro rather than overlapping it.
    is_pro, until = await pro_status(session, subject_type, subject_id)
    if is_pro and until is None:
        ends_at = None  # already Pro forever; record the redemption anyway
    elif promo.duration_days is None:
        ends_at = None
    else:
        ends_at = (until if is_pro and until else now) + timedelta(days=promo.duration_days)

    session.add(ProGrant(
        subject_type=subject_type, subject_id=subject_id, source="code",
        promo_code_id=promo.id, redeemed_by=uuid.UUID(user_id),
        starts_at=now, ends_at=ends_at, created_at=now,
    ))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "This code was already redeemed for your account")
    return await plan_summary(session, user_id)
