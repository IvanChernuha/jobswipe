from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from app.deps import get_current_user
from app.models.swipe import SwipeRequest, SwipeResponse, UndoResponse
from app.models.organization import has_permission
from app.db.client import get_client
from app.tasks.notifications import send_match_email


def _check_org_permission(db, user: dict, action: str):
    """Check org permission for employer users. Workers skip this check."""
    if user["role"] != "employer":
        return
    membership = (
        db.table("org_members")
        .select("role")
        .eq("user_id", user["id"])
        .limit(1)
        .execute()
    )
    if membership.data:
        org_role = membership.data[0]["role"]
        if not has_permission(org_role, action):
            raise HTTPException(403, f"Your role ({org_role}) cannot perform: {action}")

router = APIRouter(prefix="/swipes", tags=["swipes"])


def _fire_match_email(worker_email: str, emp_email: str, title: str) -> None:
    """Best-effort email — never crashes the swipe endpoint."""
    try:
        send_match_email.delay(worker_email, emp_email, title)
    except Exception:
        pass


@router.post("", response_model=SwipeResponse, status_code=201)
async def record_swipe(body: SwipeRequest, user: dict = Depends(get_current_user)):
    db = get_client()
    user_id = user["id"]
    role = user["role"]

    # Org permission check: viewers can pass but not like/super_like
    if body.direction == "pass":
        _check_org_permission(db, user, "swipe_pass")
    else:
        _check_org_permission(db, user, "swipe")

    # Prevent duplicate swipes
    existing = (
        db.table("swipes")
        .select("id")
        .eq("swiper_id", user_id)
        .eq("target_id", body.target_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(409, "Already swiped on this target")

    # Insert swipe
    db.table("swipes").insert({
        "swiper_id": user_id,
        "swiper_type": role,
        "target_id": body.target_id,
        "direction": body.direction,
    }).execute()

    if body.direction == "pass":
        return SwipeResponse(matched=False)

    # TODO(REVERT): Temporary non-mutual matching for testing.
    # Remove this block and uncomment the mutual matching logic below
    # when ready for production. Tracked in OpenProject #559.
    matched = False
    match_id = None

    if role == "worker":
        try:
            job = db.table("job_postings").select("employer_id, title").eq("id", body.target_id).single().execute()
        except APIError:
            return SwipeResponse(matched=False)
        if not job.data:
            return SwipeResponse(matched=False)

        employer_id = job.data["employer_id"]
        job_title = job.data.get("title", "a job")

        # TEMP: instant match on single like (no mutual needed)
        match_res = db.table("matches").insert({
            "worker_id": user_id,
            "employer_id": employer_id,
            "job_posting_id": body.target_id,
        }).execute()
        if match_res.data:
            matched = True
            match_id = match_res.data[0]["id"]

            emp_user = db.table("users").select("email").eq("id", employer_id).single().execute()
            emp_email = emp_user.data["email"] if emp_user.data else ""
            _fire_match_email(user.get("email", ""), emp_email, job_title)

    else:
        # TEMP: instant match on single like (no mutual needed)
        # Pick the first active job as the matched job
        employer_jobs = (
            db.table("job_postings")
            .select("id")
            .eq("employer_id", user_id)
            .eq("active", True)
            .execute()
        )
        job_ids = [j["id"] for j in (employer_jobs.data or [])]
        matched_job_id = job_ids[0] if job_ids else None

        match_res = db.table("matches").insert({
            "worker_id": body.target_id,
            "employer_id": user_id,
            "job_posting_id": matched_job_id,
        }).execute()
        if match_res.data:
            matched = True
            match_id = match_res.data[0]["id"]

            job_title = "a job"
            if matched_job_id:
                job_row = db.table("job_postings").select("title").eq("id", matched_job_id).single().execute()
                job_title = job_row.data["title"] if job_row.data else "a job"
            worker_user = db.table("users").select("email").eq("id", body.target_id).single().execute()
            worker_email = worker_user.data["email"] if worker_user.data else ""
            _fire_match_email(worker_email, user.get("email", ""), job_title)

    # TODO(REVERT): Original mutual matching logic — uncomment when done testing:
    # if role == "worker":
    #     reverse = db.table("swipes").select("id").eq("swiper_id", employer_id)
    #         .eq("target_id", user_id).in_("direction", ["like", "super_like"]).execute()
    #     if reverse.data: ... create match ...
    # else:
    #     reverse = db.table("swipes").select("target_id").eq("swiper_id", body.target_id)
    #         .in_("direction", ["like", "super_like"])
    #         .in_("target_id", job_ids).execute()
    #     if reverse.data: ... create match ...

    return SwipeResponse(matched=matched, match_id=match_id)


@router.delete("/last", response_model=UndoResponse)
async def undo_last_swipe(user: dict = Depends(get_current_user)):
    """Undo the most recent swipe. Removes the swipe and any resulting match."""
    db = get_client()
    user_id = user["id"]

    # Org permission check: viewers can undo passes (swipe_pass)
    _check_org_permission(db, user, "swipe_pass")

    # Find the most recent swipe by this user
    last = (
        db.table("swipes")
        .select("id, target_id, direction")
        .eq("swiper_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not last.data:
        raise HTTPException(404, "No swipes to undo")

    swipe = last.data[0]
    swipe_id = swipe["id"]
    target_id = swipe["target_id"]

    # If it was a like or super_like, clean up any match that was created
    if swipe["direction"] in ("like", "super_like"):
        role = user["role"]
        if role == "worker":
            # Worker liked a job posting — match has worker_id=me, job_posting_id=target
            db.table("matches").delete().eq("worker_id", user_id).eq("job_posting_id", target_id).execute()
        else:
            # Employer liked a worker — match has employer_id=me, worker_id=target
            db.table("matches").delete().eq("employer_id", user_id).eq("worker_id", target_id).execute()

    # Delete the swipe
    db.table("swipes").delete().eq("id", swipe_id).execute()

    return UndoResponse(undone=True, target_id=target_id)
