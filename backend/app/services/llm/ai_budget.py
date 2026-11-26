"""Monthly AI spending cap (user 2026-11-24: Claude "with a limit so we won't
spend too much").

Every Claude call adds its real cost, priced from the token usage the API
returns, to this month's total in Redis. Before each call, ensure_budget()
refuses once the month's AI_MONTHLY_BUDGET_USD is used up (0 = AI off), so
the AI pauses until the 1st. One call can go over by its own cost at most.

The per-account daily quota (services/llm_quota.py) stops one person using it
all; this caps the whole bill. The Anthropic Console's spend limit is the
hard backstop behind both (its error also counts as "budget used up").

Redis keys: ai:spend:YYYYMM, a hash of "total_micro", "calls" and
"<feature>:micro" / "<feature>:calls" (micro = millionths of a dollar).
Redis keeps them on disk (redis_data volume). If Redis is unreachable the
check fails open (logged at ERROR) and the Console limit still applies.
"""
import logging
import math
from datetime import datetime, timezone

from redis.asyncio import from_url

from app.config import settings

logger = logging.getLogger(__name__)

# USD per million tokens: (input, output, cache read). Cache writes cost 1.25x input.
PRICES: dict[str, tuple[float, float, float]] = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-opus-5": (5.00, 25.00, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00, 0.10),
    "claude-sonnet-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}
# A model missing from the table is priced like the most expensive one, never as free.
_UNKNOWN_PRICE = (10.00, 50.00, 1.00)
_KEY_TTL_SECONDS = 400 * 86400  # keep a year of months for the admin page


class AIBudgetExceeded(Exception):
    """This month's AI budget is used up (or the AI is switched off)."""


def _redis_factory():
    # A client per use: Celery tasks run each call in a fresh event loop
    # (asyncio.run), so a shared async client would be tied to a dead loop.
    return from_url(settings.REDIS_URL, decode_responses=True)


def month_key(now: datetime | None = None) -> str:
    return f"ai:spend:{(now or datetime.now(timezone.utc)):%Y%m}"


def call_cost_usd(model: str, usage) -> float:
    price_in, price_out, price_cache_read = PRICES.get(model, _UNKNOWN_PRICE)
    tokens_in = getattr(usage, "input_tokens", 0) or 0
    tokens_out = getattr(usage, "output_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    return (
        tokens_in * price_in + tokens_out * price_out
        + cache_write * price_in * 1.25 + cache_read * price_cache_read
    ) / 1_000_000


async def _spent_micro() -> int:
    r = _redis_factory()
    try:
        return int(await r.hget(month_key(), "total_micro") or 0)
    finally:
        await r.aclose()


async def budget_left() -> bool:
    """Is there budget left this month? (Fails open if Redis is down.)"""
    budget = settings.AI_MONTHLY_BUDGET_USD
    if budget <= 0:
        return False
    try:
        return await _spent_micro() < budget * 1_000_000
    except Exception as e:
        logger.error("ai_budget: redis unavailable (%s) - failing open", e)
        return True


async def ensure_budget() -> None:
    """Raise AIBudgetExceeded when this month's budget is used up."""
    if not await budget_left():
        raise AIBudgetExceeded()


async def record_spend(feature: str, model: str, usage) -> float:
    """Add one call's cost to this month's spend; returns the cost in USD."""
    cost = call_cost_usd(model, usage)
    micro = math.ceil(cost * 1_000_000)
    key = month_key()
    r = _redis_factory()
    try:
        await r.hincrby(key, "total_micro", micro)
        await r.hincrby(key, "calls", 1)
        await r.hincrby(key, f"{feature}:micro", micro)
        await r.hincrby(key, f"{feature}:calls", 1)
        await r.expire(key, _KEY_TTL_SECONDS)
    except Exception as e:
        logger.error("ai_budget: could not record $%.4f of %s spend (%s)", cost, feature, e)
    finally:
        await r.aclose()
    return cost


async def spend_summary() -> dict:
    """This month's AI spend for the admin page."""
    now = datetime.now(timezone.utc)
    r = _redis_factory()
    try:
        raw = await r.hgetall(month_key(now))
    finally:
        await r.aclose()
    by_feature: dict[str, dict] = {}
    for field, value in raw.items():
        if ":" not in field:
            continue
        feature, kind = field.rsplit(":", 1)
        entry = by_feature.setdefault(feature, {"calls": 0, "spent_usd": 0.0})
        if kind == "calls":
            entry["calls"] = int(value)
        elif kind == "micro":
            entry["spent_usd"] = int(value) / 1_000_000
    return {
        "month": f"{now:%Y-%m}",
        "spent_usd": int(raw.get("total_micro", 0)) / 1_000_000,
        "calls": int(raw.get("calls", 0)),
        "budget_usd": settings.AI_MONTHLY_BUDGET_USD,
        "model": settings.CLAUDE_MODEL,
        "by_feature": by_feature,
    }
