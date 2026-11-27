"""Keep an employer's JobSwipe jobs in step with their hiring system (Comeet).

OpenProject #3297; rules in docs/worklog/comeet-import.md. Per connection,
matched on the position's id in Comeet:
- new there       → new job here, live (within the plan's limit), AI-tagged;
- changed there   → text/location updated and re-tagged; on/off is left alone,
                    so a job the employer switched off here stays off;
- gone there      → switched off here;
- still there     → expiry pushed forward, so live Comeet jobs don't expire.
The job check (job_quality.py) applies: a job missing something (e.g. no
skills because the AI couldn't read it) comes in switched off with
held_reason "incomplete", and switches on by itself once a sync completes it.
If the AI can't read a job (paused, refused, not set up), it's read again on
the next sync.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables.ats import AtsConnection
from app.models.tables.job import JobPosting, JobPostingTag
from app.services.comeet import ComeetError, fetch_positions, position_to_job
from app.services.job_parsing import load_taxonomy, profile_to_form
from app.services.job_quality import blocking, job_issues
from app.services.plans import assert_can_go_live

logger = logging.getLogger(__name__)

STALE_AFTER = timedelta(hours=24)
STUCK_AFTER = timedelta(hours=1)
LIVE_FOR = timedelta(days=30)
# Stored as "last changed in Comeet" when Comeet gives no date, so an
# AI-read job isn't re-read every sync (None means "not read yet").
_NO_DATE = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _default_provider():
    try:
        from app.services.llm.factory import get_llm_provider
        return get_llm_provider()
    except Exception as e:  # no key / unknown provider: import without skills
        logger.warning("ats_sync: AI not available (%s), importing without skills", e)
        return None


async def _can_go_live(session: AsyncSession, employer_id: uuid.UUID) -> bool:
    try:
        await assert_can_go_live(session, str(employer_id))
        return True
    except HTTPException:
        return False


async def _issues(session: AsyncSession, job: JobPosting) -> list[dict]:
    levels = (await session.execute(
        select(JobPostingTag.requirement).where(JobPostingTag.job_posting_id == job.id)
    )).scalars().all()
    return job_issues(
        title=job.title, description=job.description, location=job.location, remote=job.remote,
        skill_count=len(levels), required_skill_count=sum(1 for lv in levels if lv == "required"),
        salary_min=job.salary_min, salary_max=job.salary_max,
    )


async def _read_with_ai(session, job: JobPosting, fields: dict, provider, taxonomy: dict[str, str]) -> bool:
    """Tag the job from the AI's reading. False if the AI couldn't read it."""
    if provider is None:
        return False
    try:
        profile = await provider.extract_job_profile(fields["ai_text"], list(taxonomy))
    except Exception as e:
        logger.warning("ats_sync: AI couldn't read job %s (%s)", job.id, type(e).__name__)
        return False
    form = profile_to_form(profile, taxonomy)
    await session.execute(delete(JobPostingTag).where(JobPostingTag.job_posting_id == job.id))
    added: set[str] = set()
    for level, ids in (("required", form["required_tag_ids"]), ("preferred", form["preferred_tag_ids"]),
                       ("nice", form["tag_ids"])):
        for tag_id in ids:
            if tag_id not in added:
                added.add(tag_id)
                session.add(JobPostingTag(job_posting_id=job.id, tag_id=uuid.UUID(tag_id), requirement=level))
    if profile.min_experience_years is not None:
        job.min_experience_years = profile.min_experience_years
    if profile.salary_min:
        job.salary_min, job.salary_max = profile.salary_min, profile.salary_max or profile.salary_min
    return True


async def sync_connection(session: AsyncSession, conn: AtsConnection, *, fetch=fetch_positions,
                          provider=None) -> dict | None:
    """Sync one connection. Returns counts, or None if Comeet couldn't be read."""
    try:
        positions = await fetch(conn.company_uid, conn.token)
    except ComeetError as e:
        conn.status, conn.last_error = "error", str(e)
        await session.commit()
        return None

    provider = provider if provider is not None else _default_provider()
    taxonomy = await load_taxonomy(session)
    rows = (await session.execute(
        select(JobPosting).where(JobPosting.employer_id == conn.employer_id, JobPosting.source == conn.provider)
    )).scalars().all()
    existing = {job.source_id: job for job in rows}
    now = datetime.now(timezone.utc)
    counts = {"added": 0, "updated": 0, "closed": 0, "untagged": 0}
    seen: set[str] = set()

    for position in positions:
        fields = position_to_job(position)
        source_id = fields["source_id"]
        if not source_id or not fields["title"] or source_id in seen:
            continue
        seen.add(source_id)
        changed_at = fields["source_updated_at"] or _NO_DATE
        job = existing.get(source_id)

        if job is None:
            job = JobPosting(
                id=uuid.uuid4(), employer_id=conn.employer_id, title=fields["title"],
                description=fields["description"], location=fields["location"], remote=fields["remote"],
                min_experience_years=fields["min_experience_years"], skills_required=[],
                salary_min=0, salary_max=0,
                active=False,  # goes live below, once it passes the job check
                source=conn.provider, source_id=source_id, source_url=fields["source_url"],
                created_at=now, updated_at=now, expires_at=now + LIVE_FOR,
            )
            session.add(job)
            await session.flush()
            counts["added"] += 1
            needs_reading = is_new = True
        else:
            is_new = False
            # None = the AI hasn't read it yet: read it again, but it's not a change in Comeet.
            needs_reading = job.source_updated_at != changed_at
            if needs_reading:
                job.title, job.description = fields["title"], fields["description"]
                job.location, job.remote = fields["location"], fields["remote"]
                job.source_url, job.updated_at = fields["source_url"], now
                if job.source_updated_at is not None:
                    counts["updated"] += 1

        if job.expires_at is None or job.expires_at < now + LIVE_FOR:
            job.expires_at = now + LIVE_FOR
        if needs_reading:
            if await _read_with_ai(session, job, fields, provider, taxonomy):
                job.source_updated_at = changed_at
            else:
                job.source_updated_at = None
                counts["untagged"] += 1

        # New, or held back by the job check: live once complete (and the plan allows).
        if is_new or job.held_reason == "incomplete":
            await session.flush()
            if blocking(await _issues(session, job)):
                job.active, job.held_reason = False, "incomplete"
            else:
                job.held_reason = None
                job.active = await _can_go_live(session, conn.employer_id)
            await session.flush()

    for source_id, job in existing.items():
        if source_id not in seen and job.active:
            job.active, job.updated_at = False, now
            counts["closed"] += 1

    conn.status, conn.last_synced_at, conn.last_error = "connected", now, None
    await session.commit()
    logger.info("ats_sync: %s connection %s: %s", conn.provider, conn.id, counts)
    return counts


async def sync_all(session: AsyncSession, *, fetch=fetch_positions, provider=None) -> int:
    """Sync every connection (the daily run). Returns how many were synced."""
    connections = (await session.execute(select(AtsConnection))).scalars().all()
    done = 0
    for conn in connections:
        try:
            if await sync_connection(session, conn, fetch=fetch, provider=provider) is not None:
                done += 1
        except Exception:
            logger.exception("ats_sync: connection %s failed", conn.id)
            await session.rollback()
    return done


def is_stale(conn: AtsConnection, now: datetime | None = None) -> bool:
    """Should a sync start now? Yes a day after the last one, or if one has
    been "importing" for over an hour (it died, e.g. in a restart)."""
    now = now or datetime.now(timezone.utc)
    if conn.status == "importing":
        return conn.sync_started_at is not None and now - conn.sync_started_at > STUCK_AFTER
    return conn.last_synced_at is None or now - conn.last_synced_at > STALE_AFTER


def mark_importing(conn: AtsConnection) -> None:
    conn.status, conn.sync_started_at = "importing", datetime.now(timezone.utc)


async def run_sync(connection_id: uuid.UUID) -> None:
    """Background task: sync one connection in its own database session."""
    from app.db.session import _get_async_sessionmaker
    async with _get_async_sessionmaker()() as session:
        conn = await session.get(AtsConnection, connection_id)
        if conn is None:
            return
        try:
            await sync_connection(session, conn)
        except Exception:
            logger.exception("ats_sync: background sync of %s failed", connection_id)
            await session.rollback()
            conn = await session.get(AtsConnection, connection_id)
            if conn is not None:
                conn.status, conn.last_error = "error", "The import stopped unexpectedly. Try Sync now."
                await session.commit()
