import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.client import get_supabase_client
from app.db.session import get_session
from app.models.tables.worker import WorkerProfile
from app.models.tables.employer import EmployerProfile

router = APIRouter(prefix="/uploads", tags=["uploads"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_RESUME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
RESUME_EXTENSIONS = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_RESUME_BYTES = 10 * 1024 * 1024


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, or WebP images allowed")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "File must be under 5 MB")

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    path = f"avatars/{user['id']}/avatar.{ext}"

    # Supabase Storage for file upload
    sb = get_supabase_client()
    try:
        sb.storage.from_("avatars").upload(path, content, {"content-type": file.content_type, "upsert": "true"})
    except Exception:
        raise HTTPException(500, "Failed to upload image")
    public_url = sb.storage.from_("avatars").get_public_url(path)

    # SQLModel for DB update
    uid = uuid.UUID(user["id"])
    if user["role"] == "worker":
        profile = await session.get(WorkerProfile, uid)
        if profile:
            profile.avatar_url = public_url
            session.add(profile)
            await session.commit()
    else:
        profile = await session.get(EmployerProfile, uid)
        if profile:
            profile.logo_url = public_url
            session.add(profile)
            await session.commit()

    return {"url": public_url}


@router.post("/resume")
async def upload_resume(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if user["role"] != "worker":
        raise HTTPException(403, "Only workers can upload resumes")
    if file.content_type not in ALLOWED_RESUME_TYPES:
        raise HTTPException(400, "Only PDF, DOCX, or TXT files allowed")

    content = await file.read()
    if len(content) > MAX_RESUME_BYTES:
        raise HTTPException(400, "Resume must be under 10 MB")

    ext = RESUME_EXTENSIONS[file.content_type]
    path = f"resumes/{user['id']}/resume.{ext}"

    # Supabase Storage
    sb = get_supabase_client()
    try:
        sb.storage.from_("resumes").upload(path, content, {"content-type": file.content_type, "upsert": "true"})
    except Exception:
        raise HTTPException(500, "Failed to upload resume")

    signed = sb.storage.from_("resumes").create_signed_url(path, 604800)
    url = signed.get("signedURL", "")

    # SQLModel for DB update
    uid = uuid.UUID(user["id"])
    profile = await session.get(WorkerProfile, uid)
    if profile:
        profile.resume_url = url
        session.add(profile)
        await session.commit()

    # Trigger async CV tag extraction
    from app.tasks.cv_processing import extract_cv_tags
    extract_cv_tags.delay(user["id"], base64.b64encode(content).decode(), file.content_type)

    return {"url": url}
