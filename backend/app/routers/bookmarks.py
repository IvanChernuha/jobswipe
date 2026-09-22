import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.session import get_session
from app.services.content_filter import assert_clean
from app.services.org_access import get_org_employer_ids
from app.models.tag import Tag as TagResponse
from app.models.tables.bookmark import Bookmark
from app.models.tables.bookmark_note import BookmarkNote
from app.models.tables.job import JobPosting, JobPostingTag
from app.models.tables.tag import Tag
from app.models.tables.worker import WorkerProfile, WorkerTag
from app.models.tables.employer import EmployerProfile
from app.models.tables.organization import OrgMember
from app.models.tables.user import User
from app.services.scoring import (
    expand_tags_with_implications_async, batch_expand_implications, compute_match_score,
)

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


def _clean_note(v: str) -> str:
    if len(v) > 2000:
        raise ValueError("note cannot exceed 2000 characters")
    assert_clean(v, "note")
    return v


class BookmarkRequest(BaseModel):
    target_id: str
    note: str = ""

    @field_validator("note")
    @classmethod
    def note_clean(cls, v: str) -> str:
        return _clean_note(v)


class BookmarkMoveRequest(BaseModel):
    job_posting_id: Optional[str] = None


class BookmarkNoteRequest(BaseModel):
    note: str

    @field_validator("note")
    @classmethod
    def note_clean(cls, v: str) -> str:
        return _clean_note(v)


class BookmarkNoteOut(BaseModel):
    id: str
    author_id: str
    author_email: str = ""
    body: str
    created_at: Optional[str] = None
    is_mine: bool = False
    model_config = {"extra": "ignore"}


class BookmarkTarget(BaseModel):
    id: str
    user_id: str
    target_id: str
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    job_posting_id: Optional[str] = None
    note: str = ""
    notes: list[BookmarkNoteOut] = []
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    experience_years: Optional[int] = None
    skills: Optional[list[str]] = None
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    description: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    remote: Optional[bool] = None
    tags: list[TagResponse] = []
    model_config = {"extra": "ignore"}


class BookmarkBasic(BaseModel):
    id: str
    user_id: str
    target_id: str
    job_posting_id: Optional[str] = None
    note: str = ""
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    model_config = {"extra": "ignore"}


class BookmarkGroup(BaseModel):
    job_posting_id: Optional[str] = None
    job_title: str
    bookmarks: list[BookmarkTarget] = []
    model_config = {"extra": "ignore"}


def _bm_to_basic(bm: Bookmark) -> dict:
    return {
        "id": str(bm.id), "user_id": str(bm.user_id), "target_id": str(bm.target_id),
        "job_posting_id": str(bm.job_posting_id) if bm.job_posting_id else None,
        "note": bm.note or "", "created_at": str(bm.created_at) if bm.created_at else None,
        "expires_at": str(bm.expires_at) if bm.expires_at else None,
    }


async def _bookmark_owner_scope(session: AsyncSession, user: dict) -> list[uuid.UUID]:
    """user_ids whose bookmarks the caller can see/act on. Employers share a
    team-wide list (any org member); workers only ever see their own."""
    uid = uuid.UUID(user["id"])
    if user["role"] != "employer":
        return [uid]
    ids = await get_org_employer_ids(session, user["id"])
    return [uuid.UUID(i) for i in ids]


async def _notes_for_bookmarks(
    session: AsyncSession, bookmark_ids: list[uuid.UUID], current_uid: uuid.UUID,
) -> dict[uuid.UUID, list[dict]]:
    """Batch-load the note thread (with author email) for a set of bookmarks."""
    if not bookmark_ids:
        return {}
    result = await session.execute(
        select(BookmarkNote).where(BookmarkNote.bookmark_id.in_(bookmark_ids)).order_by(BookmarkNote.created_at)
    )
    notes = result.scalars().all()
    if not notes:
        return {}

    author_ids = list({n.author_id for n in notes})
    ur = await session.execute(select(User.id, User.email).where(User.id.in_(author_ids)))
    email_by_id = {r.id: r.email for r in ur.all()}

    out: dict[uuid.UUID, list[dict]] = {}
    for n in notes:
        out.setdefault(n.bookmark_id, []).append({
            "id": str(n.id), "author_id": str(n.author_id),
            "author_email": email_by_id.get(n.author_id, ""),
            "body": n.body, "created_at": str(n.created_at) if n.created_at else None,
            "is_mine": n.author_id == current_uid,
        })
    return out


async def _auto_assign_job(session: AsyncSession, employer_scope: list[uuid.UUID], worker_target_id: str) -> Optional[uuid.UUID]:
    uid = uuid.UUID(worker_target_id)

    wt_result = await session.execute(select(WorkerTag.tag_id).where(WorkerTag.worker_id == uid))
    worker_tag_ids = {str(r.tag_id) for r in wt_result.all()}
    if not worker_tag_ids:
        return None

    worker_expanded = await expand_tags_with_implications_async(session, worker_tag_ids)

    jr = await session.execute(
        select(JobPosting.id).where(JobPosting.employer_id.in_(employer_scope), JobPosting.active == True)
    )
    job_ids = [r.id for r in jr.all()]
    if not job_ids:
        return None

    jtr = await session.execute(
        select(JobPostingTag.job_posting_id, JobPostingTag.tag_id).where(JobPostingTag.job_posting_id.in_(job_ids))
    )
    tags_by_job: dict[uuid.UUID, set[str]] = {}
    all_tag_ids: set[str] = set()
    for r in jtr.all():
        tid = str(r.tag_id)
        tags_by_job.setdefault(r.job_posting_id, set()).add(tid)
        all_tag_ids.add(tid)

    impl_map = await batch_expand_implications(session, all_tag_ids)

    best_job = None
    best_pct = 0
    for jid, jtags in tags_by_job.items():
        expanded = set(jtags)
        for tid in jtags:
            expanded |= impl_map.get(tid, set())
        score = compute_match_score(worker_expanded, expanded)
        if score["percentage"] > best_pct:
            best_pct = score["percentage"]
            best_job = jid

    return best_job if best_pct > 0 else None


@router.get("", response_model=list[BookmarkGroup])
async def list_bookmarks_grouped(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    role = user["role"]
    now = datetime.now(timezone.utc)
    scope = await _bookmark_owner_scope(session, user)

    result = await session.execute(
        select(Bookmark)
        .where(Bookmark.user_id.in_(scope), Bookmark.expires_at >= now)
        .order_by(Bookmark.created_at.desc())
    )
    bookmarks = result.scalars().all()
    if not bookmarks:
        return []

    target_ids = [bm.target_id for bm in bookmarks]

    if role == "worker":
        # Worker bookmarks = job postings
        jr = await session.execute(select(JobPosting).where(JobPosting.id.in_(target_ids)))
        jobs_by_id = {j.id: j for j in jr.scalars().all()}

        emp_ids = list({j.employer_id for j in jobs_by_id.values()})
        ep_by_id = {}
        if emp_ids:
            epr = await session.execute(select(EmployerProfile).where(EmployerProfile.user_id.in_(emp_ids)))
            ep_by_id = {ep.user_id: ep for ep in epr.scalars().all()}

        jtr = await session.execute(
            select(JobPostingTag.job_posting_id, JobPostingTag.requirement, Tag.id, Tag.name, Tag.category)
            .join(Tag, Tag.id == JobPostingTag.tag_id)
            .where(JobPostingTag.job_posting_id.in_(target_ids))
        )
        tags_by_job: dict[uuid.UUID, list[dict]] = {}
        for r in jtr.all():
            tags_by_job.setdefault(r.job_posting_id, []).append(
                {"id": str(r.id), "name": r.name, "category": r.category, "requirement": r.requirement}
            )

        enriched = []
        for bm in bookmarks:
            job = jobs_by_id.get(bm.target_id)
            ep = ep_by_id.get(job.employer_id) if job else None
            enriched.append({
                **_bm_to_basic(bm),
                "job_title": job.title if job else None,
                "description": job.description if job else None,
                "company_name": ep.company_name if ep else None,
                "avatar_url": ep.logo_url if ep else None,
                "salary_min": job.salary_min if job else None,
                "salary_max": job.salary_max if job else None,
                "location": job.location if job else None,
                "remote": job.remote if job else None,
                "tags": tags_by_job.get(bm.target_id, []),
            })
        return [BookmarkGroup(job_posting_id=None, job_title="All Saved", bookmarks=enriched)]

    else:
        # Employer bookmarks = workers, grouped by job
        wpr = await session.execute(select(WorkerProfile).where(WorkerProfile.user_id.in_(target_ids)))
        wp_by_id = {wp.user_id: wp for wp in wpr.scalars().all()}

        wtr = await session.execute(
            select(WorkerTag.worker_id, Tag.id, Tag.name, Tag.category)
            .join(Tag, Tag.id == WorkerTag.tag_id)
            .where(WorkerTag.worker_id.in_(target_ids))
        )
        tags_by_worker: dict[uuid.UUID, list[dict]] = {}
        for r in wtr.all():
            tags_by_worker.setdefault(r.worker_id, []).append(
                {"id": str(r.id), "name": r.name, "category": r.category}
            )

        jp_ids = list({bm.job_posting_id for bm in bookmarks if bm.job_posting_id})
        job_titles = {}
        if jp_ids:
            jtr2 = await session.execute(select(JobPosting.id, JobPosting.title).where(JobPosting.id.in_(jp_ids)))
            job_titles = {r.id: r.title for r in jtr2.all()}

        notes_by_bookmark = await _notes_for_bookmarks(session, [bm.id for bm in bookmarks], uid)

        groups_map: dict[Optional[uuid.UUID], list[dict]] = {}
        for bm in bookmarks:
            wp = wp_by_id.get(bm.target_id)
            enriched_bm = {
                **_bm_to_basic(bm),
                "name": wp.name if wp else None,
                "avatar_url": wp.avatar_url if wp else None,
                "bio": wp.bio if wp else None,
                "location": wp.location if wp else None,
                "experience_years": wp.experience_years if wp else None,
                "skills": wp.skills if wp else None,
                "tags": tags_by_worker.get(bm.target_id, []),
                "notes": notes_by_bookmark.get(bm.id, []),
            }
            groups_map.setdefault(bm.job_posting_id, []).append(enriched_bm)

        out = []
        for jpid, bms in groups_map.items():
            if jpid is not None:
                out.append(BookmarkGroup(
                    job_posting_id=str(jpid),
                    job_title=job_titles.get(jpid, "Unknown Job"),
                    bookmarks=bms,
                ))
        if None in groups_map:
            out.append(BookmarkGroup(job_posting_id=None, job_title="Unsorted", bookmarks=groups_map[None]))
        return out


@router.post("", response_model=BookmarkBasic, status_code=201)
async def add_bookmark(
    body: BookmarkRequest, user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    target = uuid.UUID(body.target_id)
    scope = await _bookmark_owner_scope(session, user)

    existing = await session.execute(
        select(Bookmark.id).where(Bookmark.user_id.in_(scope), Bookmark.target_id == target)
    )
    if existing.first():
        raise HTTPException(409, "Already bookmarked")

    job_posting_id = None
    if user["role"] == "employer":
        job_posting_id = await _auto_assign_job(session, scope, body.target_id)

    bm = Bookmark(
        id=uuid.uuid4(), user_id=uid, target_id=target,
        job_posting_id=job_posting_id, note=body.note,
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + __import__('datetime').timedelta(days=30),
    )
    session.add(bm)
    await session.commit()
    return _bm_to_basic(bm)


@router.patch("/{target_id}/move", response_model=BookmarkBasic)
async def move_bookmark(
    target_id: str, body: BookmarkMoveRequest, user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    scope = await _bookmark_owner_scope(session, user)
    result = await session.execute(
        select(Bookmark).where(Bookmark.user_id.in_(scope), Bookmark.target_id == uuid.UUID(target_id))
    )
    bm = result.scalars().first()
    if not bm:
        raise HTTPException(404, "Bookmark not found")

    if body.job_posting_id:
        job = await session.get(JobPosting, uuid.UUID(body.job_posting_id))
        if not job:
            raise HTTPException(404, "Job posting not found")

    bm.job_posting_id = uuid.UUID(body.job_posting_id) if body.job_posting_id else None
    session.add(bm)
    await session.commit()
    return _bm_to_basic(bm)


@router.patch("/{target_id}/note", response_model=BookmarkBasic)
async def update_note(
    target_id: str, body: BookmarkNoteRequest, user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    result = await session.execute(
        select(Bookmark).where(Bookmark.user_id == uid, Bookmark.target_id == uuid.UUID(target_id))
    )
    bm = result.scalars().first()
    if not bm:
        raise HTTPException(404, "Bookmark not found")

    bm.note = body.note
    session.add(bm)
    await session.commit()
    return _bm_to_basic(bm)


@router.delete("/{target_id}", status_code=204)
async def remove_bookmark(
    target_id: str, user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    scope = await _bookmark_owner_scope(session, user)
    result = await session.execute(
        select(Bookmark).where(Bookmark.user_id.in_(scope), Bookmark.target_id == uuid.UUID(target_id))
    )
    bm = result.scalars().first()
    if not bm:
        raise HTTPException(404, "Bookmark not found")
    await session.delete(bm)
    await session.commit()


@router.post("/{target_id}/notes", response_model=BookmarkNoteOut, status_code=201)
async def add_note(
    target_id: str, body: BookmarkNoteRequest, user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Add a signed note to the thread. Team-shared for employers — every org
    member can add one, always attributed to its author."""
    uid = uuid.UUID(user["id"])
    scope = await _bookmark_owner_scope(session, user)
    result = await session.execute(
        select(Bookmark).where(Bookmark.user_id.in_(scope), Bookmark.target_id == uuid.UUID(target_id))
    )
    bm = result.scalars().first()
    if not bm:
        raise HTTPException(404, "Bookmark not found")

    note = BookmarkNote(bookmark_id=bm.id, author_id=uid, body=body.note, created_at=datetime.now(timezone.utc))
    session.add(note)
    await session.commit()
    await session.refresh(note)

    return {
        "id": str(note.id), "author_id": str(uid), "author_email": user.get("email", ""),
        "body": note.body, "created_at": str(note.created_at) if note.created_at else None,
        "is_mine": True,
    }


@router.delete("/{target_id}/notes/{note_id}", status_code=204)
async def delete_note(
    target_id: str, note_id: str, user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Delete a note — only its own author may remove it."""
    uid = uuid.UUID(user["id"])
    note = await session.get(BookmarkNote, uuid.UUID(note_id))
    if not note or note.author_id != uid:
        raise HTTPException(404, "Note not found")
    await session.delete(note)
    await session.commit()
