"""Celery tasks for async CV and job description tag extraction."""
import asyncio
from app.tasks.notifications import celery_app
from app.db.client import get_client
from app.services.cv_parser import extract_text
from app.services.llm.factory import get_llm_provider
from app.services.llm.batcher import calculate_batches


def _run(coro):
    """Run an async coroutine from a sync Celery task."""
    return asyncio.run(coro)


def _fetch_taxonomy() -> dict:
    """Return {name: id} for all tags in the taxonomy."""
    db = get_client()
    result = db.table("tags").select("id, name").execute()
    return {row["name"]: row["id"] for row in (result.data or [])}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def extract_cv_tags(self, worker_id: str, file_content_b64: str, content_type: str):
    """
    Parse a worker's CV and auto-apply extracted tags to their profile.
    Called after resume upload.
    """
    import base64

    db = get_client()
    db.table("worker_profiles").update({"cv_extraction_status": "processing"}).eq("user_id", worker_id).execute()

    try:
        content = base64.b64decode(file_content_b64)
        raw_text = extract_text(content, content_type)

        taxonomy = _fetch_taxonomy()
        provider = get_llm_provider()
        profile = _run(provider.extract_cv_profile(raw_text, list(taxonomy.keys())))

        tag_ids = [taxonomy[name] for name in profile.tags if name in taxonomy]

        db.table("worker_tags").delete().eq("worker_id", worker_id).execute()
        if tag_ids:
            db.table("worker_tags").insert([{"worker_id": worker_id, "tag_id": tid} for tid in tag_ids]).execute()

        # Build profile update — only overwrite fields that were extracted
        profile_update: dict = {
            "cv_extraction_status": "done",
            "cv_extracted_tag_count": len(tag_ids),
        }
        if profile.name:
            profile_update["name"] = profile.name
        if profile.location:
            profile_update["location"] = profile.location
        if profile.experience_years is not None:
            profile_update["experience_years"] = profile.experience_years
        if profile.bio:
            profile_update["bio"] = profile.bio

        db.table("worker_profiles").update(profile_update).eq("user_id", worker_id).execute()

    except Exception as exc:
        db.table("worker_profiles").update({"cv_extraction_status": "error"}).eq("user_id", worker_id).execute()
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def extract_job_tags(self, job_id: str, description: str):
    """Extract tags for a single job posting."""
    db = get_client()
    try:
        taxonomy = _fetch_taxonomy()
        provider = get_llm_provider()
        matched_names = _run(provider.extract_tags(description, list(taxonomy.keys())))
        _apply_job_tags(db, job_id, matched_names, taxonomy)
    except Exception as exc:
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def extract_job_tags_bulk(self, jobs: list[dict]):
    """
    Extract tags for multiple job postings using smart batching.

    - Small payload (fits in one call) → single API call.
    - Large payload → split into optimal batches, one Celery task per batch.

    Each job dict: {job_id: str, description: str}
    """
    db = get_client()
    try:
        taxonomy = _fetch_taxonomy()
        provider = get_llm_provider()
        batches = calculate_batches(jobs)

        for batch in batches:
            results = _run(provider.extract_tags_batch(batch, list(taxonomy.keys())))
            for job_id, matched_names in results.items():
                _apply_job_tags(db, job_id, matched_names, taxonomy)

    except Exception as exc:
        raise self.retry(exc=exc)


def _apply_job_tags(db, job_id: str, matched_names: list[str], taxonomy: dict):
    """Replace job posting tags with freshly extracted ones."""
    tag_ids = [taxonomy[name] for name in matched_names if name in taxonomy]
    db.table("job_posting_tags").delete().eq("job_posting_id", job_id).execute()
    if tag_ids:
        db.table("job_posting_tags").insert([
            {"job_posting_id": job_id, "tag_id": tid, "requirement": "preferred"}
            for tid in tag_ids
        ]).execute()
