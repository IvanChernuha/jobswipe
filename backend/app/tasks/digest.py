"""Job-expiry reminders — standalone script run by the k8s CronJob
(`k8s/cronjob.yaml`: `python -m app.tasks.digest`). Not a Celery task: there
is no celery beat service in docker-compose.yml, so this runs on its own
schedule instead of through Celery.

Notifies each employer about jobs expiring within the next 3 days. One row
per run with no de-dup — acceptable at this scale (matches the "batching is
v2" note in the notifications plan).
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db.session import get_sync_session
from app.models.tables.job import JobPosting
from app.services.notifications import notify_sync

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    now = datetime.now(timezone.utc)
    soon = now + timedelta(days=3)

    with get_sync_session() as session:
        result = session.execute(
            select(JobPosting).where(
                JobPosting.active == True,  # noqa: E712 — matches codebase convention
                JobPosting.expires_at >= now,
                JobPosting.expires_at <= soon,
            )
        )
        jobs = result.scalars().all()

        for job in jobs:
            notify_sync(
                session, job.employer_id, "account",
                "notif.job_expiring.title", params={"title": job.title}, link="/jobs",
            )
        session.commit()

    logger.info("digest: %d job-expiry reminders queued", len(jobs))


if __name__ == "__main__":
    main()
