"""CV parsing and bulk job description tag extraction endpoints."""
import asyncio
import base64
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from app.deps import get_current_user, require_worker, require_employer
from app.db.client import get_client
from app.tasks.cv_processing import extract_cv_tags, extract_job_tags, extract_job_tags_bulk
from app.services.cv_parser import extract_text
from app.services.llm.factory import get_llm_provider

router = APIRouter(prefix="/cv", tags=["cv"])

ALLOWED_CV_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_CV_BYTES = 10 * 1024 * 1024  # 10 MB


class BulkJobItem(BaseModel):
    job_id: str
    description: str


class BulkJobRequest(BaseModel):
    jobs: list[BulkJobItem]


@router.post("/parse")
async def parse_my_cv(
    file: UploadFile = File(...),
    user: dict = Depends(require_worker),
):
    """
    Upload a CV (PDF/DOCX/TXT) and trigger async tag extraction.
    Tags will be applied to the worker profile automatically.
    """
    if file.content_type not in ALLOWED_CV_TYPES:
        raise HTTPException(400, "Unsupported file type. Use PDF, DOCX, or TXT.")

    content = await file.read()
    if len(content) > MAX_CV_BYTES:
        raise HTTPException(400, "File must be under 10 MB")

    # Encode for Celery (JSON-serializable)
    content_b64 = base64.b64encode(content).decode()

    extract_cv_tags.delay(user["id"], content_b64, file.content_type)

    return {"status": "processing", "message": "CV is being analyzed. Tags will be applied shortly."}


@router.get("/status")
async def cv_extraction_status(user: dict = Depends(require_worker)):
    """Check the status of CV tag extraction for the current worker."""
    db = get_client()
    result = db.table("worker_profiles").select(
        "cv_extraction_status, cv_extracted_tag_count"
    ).eq("user_id", user["id"]).single().execute()

    if not result.data:
        raise HTTPException(404, "Profile not found")

    return result.data


@router.post("/bulk-jobs")
async def bulk_extract_job_tags(
    payload: BulkJobRequest,
    user: dict = Depends(require_employer),
):
    """
    Queue tag extraction for multiple job postings using smart batching.
    Small payloads (≤50 jobs or fits token budget) → single API call.
    Large payloads → automatically split into optimal batches.
    No hard upper limit on number of jobs.
    """
    if not payload.jobs:
        raise HTTPException(400, "No jobs provided")
    if len(payload.jobs) > MAX_BULK_JOBS:
        raise HTTPException(400, f"Maximum {MAX_BULK_JOBS} jobs per request")

    db = get_client()

    # Verify all jobs belong to this employer
    job_ids = [j.job_id for j in payload.jobs]
    result = db.table("job_postings").select("id, employer_id").in_("id", job_ids).execute()
    employer_result = db.table("employer_profiles").select("user_id").eq("user_id", user["id"]).single().execute()

    if not employer_result.data:
        raise HTTPException(403, "Employer profile not found")

    employer_id = employer_result.data["user_id"]
    valid_ids = {str(r["id"]) for r in (result.data or []) if str(r["employer_id"]) == str(employer_id)}
    invalid = [j.job_id for j in payload.jobs if j.job_id not in valid_ids]

    if invalid:
        raise HTTPException(403, f"Jobs not owned by you: {invalid}")

    # Build job list and dispatch as a single bulk task (batcher handles splitting)
    jobs = [{"job_id": j.job_id, "description": j.description} for j in payload.jobs]
    extract_job_tags_bulk.delay(jobs)

    from app.services.llm.batcher import calculate_batches
    batches = calculate_batches(jobs)

    return {
        "status": "queued",
        "queued": len(jobs),
        "batches": len(batches),
        "message": f"{len(jobs)} jobs queued across {len(batches)} API call(s).",
    }


@router.post("/jobs/{job_id}/extract")
async def extract_single_job_tags(
    job_id: str,
    user: dict = Depends(require_employer),
):
    """Re-trigger tag extraction for a single existing job posting."""
    db = get_client()

    employer_result = db.table("employer_profiles").select("user_id").eq("user_id", user["id"]).single().execute()
    if not employer_result.data:
        raise HTTPException(403, "Employer profile not found")

    job_result = db.table("job_postings").select("id, description, employer_id").eq("id", job_id).single().execute()
    if not job_result.data:
        raise HTTPException(404, "Job not found")

    if str(job_result.data["employer_id"]) != str(employer_result.data["user_id"]):
        raise HTTPException(403, "Not your job posting")

    extract_job_tags.delay(job_id, job_result.data.get("description", ""))

    return {"status": "queued", "message": "Tag extraction queued for this job."}


ALLOWED_JOB_FILE_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_JOB_FILE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_JOB_FILES = 10  # was 50 — each fires an LLM call; cap to control cost
MAX_BULK_JOBS = 200  # hard cap on bulk-jobs to prevent unbounded LLM spend
_LLM_SEMAPHORE = asyncio.Semaphore(5)  # max 5 concurrent LLM calls per request


@router.post("/parse-job-files")
async def parse_job_files(
    files: list[UploadFile] = File(...),
    user: dict = Depends(require_employer),
):
    """
    Parse 1–50 job description files (PDF/DOCX/TXT).
    Returns structured job data for each file — no DB writes.
    Employer reviews the results in the UI then confirms creation.
    """
    if len(files) > MAX_JOB_FILES:
        raise HTTPException(400, f"Maximum {MAX_JOB_FILES} files per request")

    db = get_client()
    taxonomy_rows = db.table("tags").select("id, name").execute()
    taxonomy = {row["name"]: row["id"] for row in (taxonomy_rows.data or [])}
    taxonomy_names = list(taxonomy.keys())

    provider = get_llm_provider()

    async def parse_one(file: UploadFile) -> dict:
        fname = file.filename or "unnamed"
        ct = (file.content_type or "").lower()
        # Be permissive: also accept octet-stream for txt/docx uploaded from Windows
        is_txt = fname.lower().endswith(".txt")
        is_pdf = fname.lower().endswith(".pdf")
        is_docx = fname.lower().endswith(".docx")
        effective_type = file.content_type
        if ct == "application/octet-stream":
            if is_txt: effective_type = "text/plain"
            elif is_pdf: effective_type = "application/pdf"
            elif is_docx: effective_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if effective_type not in ALLOWED_JOB_FILE_TYPES:
            return {"filename": fname, "error": f"Unsupported type: {file.content_type}"}

        content = await file.read()
        if len(content) > MAX_JOB_FILE_BYTES:
            return {"filename": fname, "error": "File too large (max 10 MB)"}

        try:
            raw_text = extract_text(content, effective_type)
            async with _LLM_SEMAPHORE:
                profile = await provider.extract_job_profile(raw_text, taxonomy_names)
            return {
                "filename": file.filename,
                "title": profile.title,
                "description": profile.description,
                "location": profile.location,
                "remote": profile.remote,
                "salary_min": profile.salary_min,
                "salary_max": profile.salary_max,
                "required_tag_ids": [taxonomy[t] for t in profile.required_tags if t in taxonomy],
                "preferred_tag_ids": [taxonomy[t] for t in profile.preferred_tags if t in taxonomy],
                "tag_ids": [taxonomy[t] for t in profile.nice_tags if t in taxonomy],
                "required_tags": profile.required_tags,
                "preferred_tags": profile.preferred_tags,
                "nice_tags": profile.nice_tags,
                "min_experience_years": profile.min_experience_years,
                "error": None,
            }
        except Exception as e:
            import logging as _log
            _log.getLogger(__name__).error("parse-job-files error for %s: %s", file.filename, e)
            return {"filename": file.filename, "error": "Failed to parse file. Please try again later."}

    results = await asyncio.gather(*[parse_one(f) for f in files])
    return {"parsed": results}
