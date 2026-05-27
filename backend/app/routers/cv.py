"""CV parsing and bulk job description tag extraction endpoints."""
import asyncio
import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, require_worker, require_employer
from app.db.session import get_session
from app.models.tables.worker import WorkerProfile
from app.models.tables.employer import EmployerProfile
from app.models.tables.job import JobPosting
from app.models.tables.tag import Tag
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
    """Upload a CV and trigger async tag extraction."""
    if file.content_type not in ALLOWED_CV_TYPES:
        raise HTTPException(400, "Unsupported file type. Use PDF, DOCX, or TXT.")

    content = await file.read()
    if len(content) > MAX_CV_BYTES:
        raise HTTPException(400, "File must be under 10 MB")

    content_b64 = base64.b64encode(content).decode()
    extract_cv_tags.delay(user["id"], content_b64, file.content_type)

    return {"status": "processing", "message": "CV is being analyzed. Tags will be applied shortly."}


@router.get("/status")
async def cv_extraction_status(
    user: dict = Depends(require_worker),
    session: AsyncSession = Depends(get_session),
):
    """Check the status of CV tag extraction for the current worker."""
    profile = await session.get(WorkerProfile, uuid.UUID(user["id"]))
    if not profile:
        raise HTTPException(404, "Profile not found")

    return {
        "cv_extraction_status": profile.cv_extraction_status,
        "cv_extracted_tag_count": profile.cv_extracted_tag_count,
    }


@router.post("/bulk-jobs")
async def bulk_extract_job_tags(
    payload: BulkJobRequest,
    user: dict = Depends(require_employer),
    session: AsyncSession = Depends(get_session),
):
    """Queue tag extraction for multiple job postings."""
    if not payload.jobs:
        raise HTTPException(400, "No jobs provided")
    if len(payload.jobs) > MAX_BULK_JOBS:
        raise HTTPException(400, f"Maximum {MAX_BULK_JOBS} jobs per request")

    # Verify all jobs belong to this employer
    job_ids = [uuid.UUID(j.job_id) for j in payload.jobs]
    result = await session.execute(
        select(JobPosting.id, JobPosting.employer_id).where(JobPosting.id.in_(job_ids))
    )
    job_rows = result.all()

    employer_id = uuid.UUID(user["id"])
    valid_ids = {str(r.id) for r in job_rows if r.employer_id == employer_id}
    invalid = [j.job_id for j in payload.jobs if j.job_id not in valid_ids]

    if invalid:
        raise HTTPException(403, f"Jobs not owned by you: {invalid}")

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
    session: AsyncSession = Depends(get_session),
):
    """Re-trigger tag extraction for a single existing job posting."""
    employer_id = uuid.UUID(user["id"])
    job = await session.get(JobPosting, uuid.UUID(job_id))

    if not job:
        raise HTTPException(404, "Job not found")
    if job.employer_id != employer_id:
        raise HTTPException(403, "Not your job posting")

    extract_job_tags.delay(job_id, job.description or "")

    return {"status": "queued", "message": "Tag extraction queued for this job."}


ALLOWED_JOB_FILE_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_JOB_FILE_BYTES = 10 * 1024 * 1024
MAX_JOB_FILES = 10
MAX_BULK_JOBS = 200
_LLM_SEMAPHORE = asyncio.Semaphore(5)


@router.post("/parse-job-files")
async def parse_job_files(
    files: list[UploadFile] = File(...),
    user: dict = Depends(require_employer),
    session: AsyncSession = Depends(get_session),
):
    """Parse job description files and return structured data."""
    if len(files) > MAX_JOB_FILES:
        raise HTTPException(400, f"Maximum {MAX_JOB_FILES} files per request")

    # Get tag taxonomy
    result = await session.execute(select(Tag.id, Tag.name))
    taxonomy = {row.name: str(row.id) for row in result.all()}
    taxonomy_names = list(taxonomy.keys())

    provider = get_llm_provider()

    async def parse_one(file: UploadFile) -> dict:
        fname = file.filename or "unnamed"
        ct = (file.content_type or "").lower()
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
