"""Celery tasks for async CV and job description tag extraction."""
import asyncio
import logging
import uuid

import httpx
from sqlalchemy import select, delete

from app.tasks.notifications import celery_app
from app.db.session import get_sync_session
from app.models.tables.tag import Tag
from app.models.tables.worker import WorkerProfile, WorkerTag
from app.models.tables.job import JobPostingTag
from app.services.cv_parser import extract_text
from app.services.llm.factory import get_llm_provider
from app.services.llm.batcher import calculate_batches

logger = logging.getLogger(__name__)

_RETRYABLE = (httpx.ConnectError, httpx.TimeoutException, ConnectionError, OSError)


def _run(coro):
    """Run an async coroutine from a sync Celery task."""
    return asyncio.run(coro)


def _fetch_taxonomy() -> dict[str, str]:
    """Return {name: id_str} for all tags."""
    with get_sync_session() as session:
        result = session.execute(select(Tag.id, Tag.name))
        return {row.name: str(row.id) for row in result.all()}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def extract_cv_tags(self, worker_id: str, file_content_b64: str, content_type: str):
    """Parse a worker's CV and auto-apply extracted tags."""
    import base64

    wid = uuid.UUID(worker_id)

    with get_sync_session() as session:
        profile = session.get(WorkerProfile, wid)
        if profile:
            profile.cv_extraction_status = "processing"
            session.commit()

    try:
        content = base64.b64decode(file_content_b64)
        raw_text = extract_text(content, content_type)

        taxonomy = _fetch_taxonomy()
        provider = get_llm_provider()
        cv_profile = _run(provider.extract_cv_profile(raw_text, list(taxonomy.keys())))

        tag_ids = [taxonomy[name] for name in cv_profile.tags if name in taxonomy]

        with get_sync_session() as session:
            session.execute(delete(WorkerTag).where(WorkerTag.worker_id == wid))
            for tid in tag_ids:
                session.add(WorkerTag(worker_id=wid, tag_id=uuid.UUID(tid)))

            profile = session.get(WorkerProfile, wid)
            if profile:
                profile.cv_extraction_status = "done"
                profile.cv_extracted_tag_count = len(tag_ids)
                if cv_profile.name:
                    profile.name = cv_profile.name
                if cv_profile.location:
                    profile.location = cv_profile.location
                if cv_profile.experience_years is not None:
                    profile.experience_years = cv_profile.experience_years
                if cv_profile.bio:
                    profile.bio = cv_profile.bio
            session.commit()

    except _RETRYABLE as exc:
        with get_sync_session() as session:
            profile = session.get(WorkerProfile, wid)
            if profile:
                profile.cv_extraction_status = "retrying"
                session.commit()
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("extract_cv_tags permanent failure for worker %s: %s", worker_id, exc)
        with get_sync_session() as session:
            profile = session.get(WorkerProfile, wid)
            if profile:
                profile.cv_extraction_status = "error"
                session.commit()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def extract_job_tags(self, job_id: str, description: str):
    """Extract tags for a single job posting."""
    try:
        taxonomy = _fetch_taxonomy()
        provider = get_llm_provider()
        matched_names = _run(provider.extract_tags(description, list(taxonomy.keys())))
        _apply_job_tags(job_id, matched_names, taxonomy)
    except _RETRYABLE as exc:
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("extract_job_tags permanent failure for job %s: %s", job_id, exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def extract_job_tags_bulk(self, jobs: list[dict]):
    """Extract tags for multiple job postings using smart batching."""
    try:
        taxonomy = _fetch_taxonomy()
        provider = get_llm_provider()
        batches = calculate_batches(jobs)

        for batch in batches:
            results = _run(provider.extract_tags_batch(batch, list(taxonomy.keys())))
            for job_id, matched_names in results.items():
                _apply_job_tags(job_id, matched_names, taxonomy)

    except _RETRYABLE as exc:
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("extract_job_tags_bulk permanent failure: %s", exc)


def _apply_job_tags(job_id: str, matched_names: list[str], taxonomy: dict[str, str]):
    """Replace job posting tags with freshly extracted ones."""
    tag_ids = [taxonomy[name] for name in matched_names if name in taxonomy]
    jid = uuid.UUID(job_id)

    with get_sync_session() as session:
        session.execute(delete(JobPostingTag).where(JobPostingTag.job_posting_id == jid))
        for tid in tag_ids:
            session.add(JobPostingTag(job_posting_id=jid, tag_id=uuid.UUID(tid), requirement="preferred"))
        session.commit()
