"""AI features are Pro-only (decision 2026-11, enforced 2026-11-11).

The AI routes (read a CV, read a job from text or a file, re-read jobs)
answer 402 on the Free plan. Free users add skills by hand. The switch
AI_PRO_ONLY turns this off (e.g. a launch promotion). The quota and rate
limits are tested elsewhere; here they are stubbed out.
"""
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile

from app.config import settings
from app.models.cv import ParseJobTextRequest
from app.models.tables import ProGrant
from app.routers import cv as cv_router
from app.services.llm.base import JobProfile

pytestmark = pytest.mark.asyncio


class FakeAI:
    async def extract_job_profile(self, text, taxonomy):
        return JobProfile(title="Read by AI")


@pytest.fixture(autouse=True)
def no_quota_no_llm(monkeypatch):
    async def free_quota(user_id, units):
        return None
    monkeypatch.setattr(cv_router, "consume_llm_units", free_quota)
    monkeypatch.setattr(cv_router, "get_llm_provider", lambda: FakeAI())
    monkeypatch.setattr(settings, "AI_PRO_ONLY", True)


async def give_pro(world, user_id):
    world.s.add(ProGrant(subject_type="user", subject_id=user_id, source="admin",
                         starts_at=datetime.now(timezone.utc) - timedelta(days=1)))
    await world.commit()


def read_job_text(user_id, session):
    # The undecorated route (the rate limiter needs a real request).
    return cv_router.parse_job_text_route.__wrapped__(
        request=None, payload=ParseJobTextRequest(text="We need a junior React developer in Tel Aviv"),
        user={"id": str(user_id), "role": "employer"}, session=session,
    )


async def test_free_employers_get_a_clear_402(session, world):
    emp = await world.employer()
    await world.commit()
    with pytest.raises(HTTPException) as e:
        await read_job_text(emp, session)
    assert e.value.status_code == 402
    assert "Pro" in e.value.detail


async def test_pro_employers_can_use_ai(session, world):
    emp = await world.employer()
    await give_pro(world, emp)
    out = await read_job_text(emp, session)
    assert out["title"] == "Read by AI"


async def test_an_expired_pro_is_free_again(session, world):
    emp = await world.employer()
    world.s.add(ProGrant(subject_type="user", subject_id=emp, source="code",
                         starts_at=datetime.now(timezone.utc) - timedelta(days=60),
                         ends_at=datetime.now(timezone.utc) - timedelta(days=30)))
    await world.commit()
    with pytest.raises(HTTPException) as e:
        await read_job_text(emp, session)
    assert e.value.status_code == 402


async def test_switch_off_lets_everyone_use_ai(session, world, monkeypatch):
    monkeypatch.setattr(settings, "AI_PRO_ONLY", False)
    emp = await world.employer()
    await world.commit()
    assert (await read_job_text(emp, session))["title"] == "Read by AI"


async def test_free_workers_cannot_have_their_cv_read(session, world):
    worker = await world.worker([])
    await world.commit()
    cv = UploadFile(filename="cv.txt", file=BytesIO(b"React developer"), headers={"content-type": "text/plain"})
    with pytest.raises(HTTPException) as e:
        await cv_router.parse_my_cv.__wrapped__(
            request=None, file=cv, user={"id": str(worker), "role": "worker"}, session=session,
        )
    assert e.value.status_code == 402


async def test_job_files_and_rereading_jobs_are_pro_too(session, world):
    emp = await world.employer()
    job = await world.job(emp)
    await world.commit()
    user = {"id": str(emp), "role": "employer"}
    with pytest.raises(HTTPException) as e:
        await cv_router.extract_single_job_tags.__wrapped__(request=None, job_id=str(job), user=user, session=session)
    assert e.value.status_code == 402
    f = UploadFile(filename="job.txt", file=BytesIO(b"React job"), headers={"content-type": "text/plain"})
    with pytest.raises(HTTPException) as e:
        await cv_router.parse_job_files.__wrapped__(request=None, files=[f], user=user, session=session)
    assert e.value.status_code == 402


class FakeBucket:
    def upload(self, path, content, opts):
        self.path = path

    def create_signed_url(self, path, seconds):
        return {"signedURL": f"https://storage.test/{path}?token=t"}


class FakeStorage:
    bucket = FakeBucket()

    def from_(self, name):
        return self.bucket


class FakeSupabase:
    storage = FakeStorage()


async def upload_cv(session, worker, monkeypatch):
    from app.routers import uploads
    from app.tasks import cv_processing
    queued = []
    monkeypatch.setattr(uploads, "get_supabase_client", lambda: FakeSupabase())
    monkeypatch.setattr(uploads, "consume_llm_units", lambda *a: _done())
    monkeypatch.setattr(cv_processing.extract_cv_tags, "delay", lambda *a: queued.append(a))
    cv = UploadFile(filename="cv.pdf", file=BytesIO(b"%PDF cv"), headers={"content-type": "application/pdf"})
    out = await uploads.upload_resume.__wrapped__(
        request=None, file=cv, user={"id": str(worker), "role": "worker"}, session=session,
    )
    return out, queued


async def _done():
    return None


async def test_free_workers_can_still_upload_a_cv_but_ai_does_not_read_it(session, world, monkeypatch):
    worker = await world.worker([])
    await world.commit()
    out, queued = await upload_cv(session, worker, monkeypatch)
    assert out["url"].endswith("resume.pdf?token=t")
    assert out["analyzing"] is False
    assert queued == []


async def test_pro_workers_get_their_cv_read(session, world, monkeypatch):
    worker = await world.worker([])
    await give_pro(world, worker)
    out, queued = await upload_cv(session, worker, monkeypatch)
    assert out["analyzing"] is True
    assert len(queued) == 1
