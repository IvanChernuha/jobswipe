"""Per-account daily LLM extraction quota (Redis counter).

Rate limits bound *requests*; this bounds *work*. One unit is one CV, job
description, or job file sent to the LLM, so a single bulk request cannot
burn the whole budget. Keys are UTC-date-scoped and expire on their own.

Fails open if Redis is unreachable (logged at ERROR -> Sentry). If Redis is
down the Celery broker is down too, so queued extraction would not run
anyway; only the on-request-path parse-job-files would be unmetered.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from app.config import settings
from app.db.redis import get_redis

logger = logging.getLogger(__name__)

_KEY_TTL_SECONDS = 2 * 86400  # key is date-scoped; TTL just garbage-collects it


def _key(user_id: str) -> str:
    return f"llm:quota:{user_id}:{datetime.now(timezone.utc):%Y%m%d}"


async def consume_llm_units(user_id: str, units: int) -> None:
    """Reserve `units` of today's quota for `user_id` or raise 429.

    Atomic INCRBY then check; on overflow the units are refunded so a rejected
    request does not eat into the remaining allowance.
    """
    if units <= 0:
        return
    limit = settings.LLM_DAILY_UNITS_PER_ACCOUNT
    try:
        r = get_redis()
        key = _key(user_id)
        total = await r.incrby(key, units)
        if total == units:  # first write today — set the TTL once
            await r.expire(key, _KEY_TTL_SECONDS)
        if total > limit:
            await r.decrby(key, units)
            raise HTTPException(
                429,
                f"Daily AI extraction quota reached ({limit} items/day). Try again tomorrow.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("llm_quota: redis unavailable (%s) — failing open", e)
