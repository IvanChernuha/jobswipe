import base64
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.deps import get_current_user
from app.db.client import get_client

router = APIRouter(prefix="/uploads", tags=["uploads"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_RESUME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "text/plain",  # .txt
}
RESUME_EXTENSIONS = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024   # 5 MB
MAX_RESUME_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Only JPEG, PNG, or WebP images allowed")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "File must be under 5 MB")

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    path = f"avatars/{user['id']}/avatar.{ext}"

    db = get_client()
    try:
        db.storage.from_("avatars").upload(path, content, {"content-type": file.content_type, "upsert": "true"})
    except Exception:
        raise HTTPException(500, "Failed to upload image")
    public_url = db.storage.from_("avatars").get_public_url(path)

    # Update profile avatar/logo field
    if user["role"] == "worker":
        db.table("worker_profiles").update({"avatar_url": public_url}).eq("user_id", user["id"]).execute()
    else:
        db.table("employer_profiles").update({"logo_url": public_url}).eq("user_id", user["id"]).execute()

    return {"url": public_url}


@router.post("/resume")
async def upload_resume(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
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
    db = get_client()
    try:
        db.storage.from_("resumes").upload(path, content, {"content-type": file.content_type, "upsert": "true"})
    except Exception:
        raise HTTPException(500, "Failed to upload resume")

    # Generate signed URL (1 week) for private bucket
    signed = db.storage.from_("resumes").create_signed_url(path, 604800)
    url = signed.get("signedURL", "")

    db.table("worker_profiles").update({"resume_url": url}).eq("user_id", user["id"]).execute()

    # Trigger async CV tag extraction
    from app.tasks.cv_processing import extract_cv_tags
    extract_cv_tags.delay(user["id"], base64.b64encode(content).decode(), file.content_type)

    return {"url": url}
