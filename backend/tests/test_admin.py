"""Admin liquidity: the test-account filter decides whether the numbers mean anything."""
from app.config import settings
from app.routers.admin import _exclude_clause


def test_include_test_disables_filter():
    assert _exclude_clause(True) == ("TRUE", {})


def test_patterns_become_bound_not_like_clauses(monkeypatch):
    monkeypatch.setattr(settings, "ANALYTICS_EXCLUDE_EMAILS", "%@t.com, demo@x.com ,")
    sql, params = _exclude_clause(False)
    assert sql == "u.email NOT LIKE :p0 AND u.email NOT LIKE :p1"
    assert params == {"p0": "%@t.com", "p1": "demo@x.com"}  # values are bound, never spliced into SQL


def test_empty_setting_excludes_nothing(monkeypatch):
    monkeypatch.setattr(settings, "ANALYTICS_EXCLUDE_EMAILS", "")
    assert _exclude_clause(False) == ("TRUE", {})
