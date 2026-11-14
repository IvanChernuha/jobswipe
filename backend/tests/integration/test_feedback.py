"""In-app feedback (user idea 2026-11-12): testers rate the app and say what
they think before the iPhone version is built; the founder reads it."""
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.models.feedback import FeedbackCreate
from app.models.tables import AppFeedback
from app.routers.feedback import list_feedback, send_feedback

pytestmark = pytest.mark.asyncio


async def test_feedback_is_stored_with_who_sent_it(session, world):
    worker = await world.worker([])
    await world.commit()

    out = await send_feedback.__wrapped__(
        request=None,
        body=FeedbackCreate(rating=4, message="  Love the swiping, chat is a bit slow  ", platform="android", app_version="0.7.0"),
        user={"id": str(worker), "role": "worker", "email": "w@test.com"}, session=session,
    )

    assert out == {"ok": True}
    row = (await session.execute(select(AppFeedback))).scalar_one()
    assert (row.user_id, row.rating, row.message, row.platform, row.app_version) == (
        worker, 4, "Love the swiping, chat is a bit slow", "android", "0.7.0",
    )


@pytest.mark.parametrize("rating", [0, 6])
async def test_rating_is_one_to_five(rating):
    with pytest.raises(ValidationError):
        FeedbackCreate(rating=rating, message="", platform="android")


async def test_message_is_capped():
    with pytest.raises(ValidationError):
        FeedbackCreate(rating=5, message="x" * 5001, platform="android")


async def test_admin_reads_it_newest_first_with_the_senders_email(session, world, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "boss@jobswipe.dev")
    a = await world.worker([])
    b = await world.employer()
    await world.commit()
    for uid, rating in ((a, 3), (b, 5)):
        await send_feedback.__wrapped__(
            request=None, body=FeedbackCreate(rating=rating, message=f"r{rating}", platform="android"),
            user={"id": str(uid), "role": "worker"}, session=session,
        )

    rows = await list_feedback(user={"id": "x", "email": "boss@jobswipe.dev"}, session=session)

    assert [(r["rating"], r["message"]) for r in rows] == [(5, "r5"), (3, "r3")]
    assert rows[0]["email"].endswith("@test.invalid")
    assert rows[0]["role"] == "employer"


async def test_your_feedback_is_in_download_my_data(session, world):
    from app.routers.gdpr import export_my_data
    worker = await world.worker([])
    await world.commit()
    await send_feedback.__wrapped__(
        request=None, body=FeedbackCreate(rating=5, message="Great app", platform="android"),
        user={"id": str(worker), "role": "worker"}, session=session,
    )
    out = await export_my_data(user={"id": str(worker), "role": "worker"}, session=session)
    assert [(f["rating"], f["message"]) for f in out["feedback"]] == [(5, "Great app")]
