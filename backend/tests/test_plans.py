"""Plan logic that needs no DB: who counts as Pro, and code handling."""
from datetime import datetime, timedelta, timezone

from app.services.plans import _CODE_ALPHABET, generate_code, normalize_code, pro_until_from

NOW = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
DAY = timedelta(days=1)


def test_no_grants_is_free():
    assert pro_until_from([], NOW) == (False, None)


def test_expired_grant_is_free():
    assert pro_until_from([(NOW - 10 * DAY, NOW - DAY)], NOW) == (False, None)


def test_future_grant_not_started_is_free():
    assert pro_until_from([(NOW + DAY, NOW + 30 * DAY)], NOW) == (False, None)


def test_active_grant_reports_its_end():
    assert pro_until_from([(NOW - DAY, NOW + 30 * DAY)], NOW) == (True, NOW + 30 * DAY)


def test_latest_end_wins_across_grants():
    grants = [(NOW - DAY, NOW + 10 * DAY), (NOW - DAY, NOW + 90 * DAY)]
    assert pro_until_from(grants, NOW) == (True, NOW + 90 * DAY)


def test_forever_grant_beats_dated_ones():
    grants = [(NOW - DAY, NOW + 10 * DAY), (NOW - DAY, None)]
    assert pro_until_from(grants, NOW) == (True, None)


def test_normalize_code_strips_spaces_and_uppercases():
    assert normalize_code("  tel aviv-50 ") == "TELAVIV-50"


def test_generated_codes_avoid_ambiguous_characters():
    for _ in range(200):
        c = generate_code()
        assert len(c) == 8 and set(c) <= set(_CODE_ALPHABET)
    assert not set("01IO") & set(_CODE_ALPHABET)
