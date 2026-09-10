"""Per-account login lockout backed by Redis.

Complements the per-IP slowapi limit on /auth/login. That stops one IP
hammering many accounts; this stops many IPs hammering one account
(credential stuffing). After LOGIN_MAX_FAILURES failed attempts the account
is locked for LOGIN_LOCKOUT_SECONDS; the window refreshes on each failure
and clears on a successful login.

Fails open if Redis is unreachable: logged at ERROR (-> Sentry) rather than
blocking every login on a cache blip. The per-IP limit still applies.
"""
import logging

from fastapi import HTTPException

from app.config import settings
from app.db.redis import get_redis

logger = logging.getLogger(__name__)


def _key(email: str) -> str:
    return f"auth:fail:{email.strip().lower()}"


async def assert_not_locked(email: str) -> None:
    try:
        count = await get_redis().get(_key(email))
    except Exception as e:
        logger.error("login_guard: redis unavailable (%s) — failing open", e)
        return
    if count is not None and int(count) >= settings.LOGIN_MAX_FAILURES:
        raise HTTPException(429, "Too many failed login attempts. Try again later.")


async def record_failure(email: str) -> None:
    try:
        r = get_redis()
        key = _key(email)
        await r.incr(key)
        await r.expire(key, settings.LOGIN_LOCKOUT_SECONDS)
    except Exception as e:
        logger.error("login_guard: could not record failure (%s)", e)


async def clear_failures(email: str) -> None:
    try:
        await get_redis().delete(_key(email))
    except Exception as e:
        logger.error("login_guard: could not clear failures (%s)", e)
