"""Unit tests for the notifications service: preference resolution, team
fan-out filtering, and the "never raise" resilience guarantee.

No DB or network — session interactions are faked (mirrors the FakeRedis
pattern in test_abuse_controls.py), since notify()/notify_team() only ever
call session.get(...), session.execute(...) and session.add(...).
"""
import asyncio
import uuid

from app.models.tables.notification import NotificationPref
from app.services.notifications import _filter_team_recipients, _is_enabled, notify, notify_team


class FakeSession:
    """Fakes the subset of AsyncSession that notify() touches."""

    def __init__(self, prefs: dict | None = None, raise_on_add: bool = False, raise_on_get: bool = False):
        self.prefs = prefs or {}
        self.added = []
        self.raise_on_add = raise_on_add
        self.raise_on_get = raise_on_get

    async def get(self, model, pk):
        if self.raise_on_get:
            raise RuntimeError("db down")
        return self.prefs.get(pk)

    def add(self, obj):
        if self.raise_on_add:
            raise RuntimeError("boom")
        self.added.append(obj)


class Row:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows


class FakeTeamSession(FakeSession):
    """Adds a canned, ordered .execute() for notify_team's two lookups:
    1) the actor's org_id, 2) that org's members."""

    def __init__(self, org_id, members, **kw):
        super().__init__(**kw)
        self.org_id = org_id
        self.members = members
        self._call = 0

    async def execute(self, stmt):
        self._call += 1
        if self._call == 1:
            return FakeResult([Row(org_id=self.org_id)] if self.org_id else [])
        return FakeResult(self.members)


class TestIsEnabled:
    def test_missing_pref_defaults_enabled(self):
        assert _is_enabled(None) is True

    def test_explicit_enabled(self):
        pref = NotificationPref(user_id=uuid.uuid4(), type="match", enabled=True)
        assert _is_enabled(pref) is True

    def test_explicit_disabled(self):
        pref = NotificationPref(user_id=uuid.uuid4(), type="match", enabled=False)
        assert _is_enabled(pref) is False


class TestFilterTeamRecipients:
    def test_excludes_actor(self):
        actor, other = uuid.uuid4(), uuid.uuid4()
        result = _filter_team_recipients(actor, [(actor, "owner"), (other, "viewer")], None)
        assert result == [other]

    def test_no_permission_includes_all_non_actors(self):
        actor = uuid.uuid4()
        a, b = uuid.uuid4(), uuid.uuid4()
        result = _filter_team_recipients(actor, [(a, "viewer"), (b, "manager")], None)
        assert set(result) == {a, b}

    def test_permission_filters_by_role(self):
        actor = uuid.uuid4()
        viewer, manager = uuid.uuid4(), uuid.uuid4()
        result = _filter_team_recipients(actor, [(viewer, "viewer"), (manager, "manager")], "chat")
        assert result == [manager]  # viewer role has no "chat" permission


class TestNotify:
    def test_default_enabled_inserts_row(self):
        session = FakeSession()
        uid = uuid.uuid4()
        asyncio.run(notify(session, uid, "match", "notif.match.title", params={"name": "Acme"}))
        assert len(session.added) == 1
        n = session.added[0]
        assert n.user_id == uid
        assert n.type == "match"
        assert n.title_key == "notif.match.title"
        assert n.params == {"name": "Acme"}

    def test_disabled_pref_skips_insert(self):
        uid = uuid.uuid4()
        pref = NotificationPref(user_id=uid, type="chat", enabled=False)
        session = FakeSession(prefs={(uid, "chat"): pref})
        asyncio.run(notify(session, uid, "chat", "notif.chat.title"))
        assert session.added == []

    def test_enabled_pref_inserts(self):
        uid = uuid.uuid4()
        pref = NotificationPref(user_id=uid, type="chat", enabled=True)
        session = FakeSession(prefs={(uid, "chat"): pref})
        asyncio.run(notify(session, uid, "chat", "notif.chat.title"))
        assert len(session.added) == 1

    def test_never_raises_when_add_fails(self):
        session = FakeSession(raise_on_add=True)
        asyncio.run(notify(session, uuid.uuid4(), "match", "notif.match.title"))

    def test_never_raises_when_get_fails(self):
        session = FakeSession(raise_on_get=True)
        asyncio.run(notify(session, uuid.uuid4(), "match", "notif.match.title"))


class TestNotifyTeam:
    def test_excludes_actor_and_respects_permission(self):
        actor = uuid.uuid4()
        org_id = uuid.uuid4()
        viewer, manager = uuid.uuid4(), uuid.uuid4()
        session = FakeTeamSession(org_id=org_id, members=[
            Row(user_id=actor, role="owner"),
            Row(user_id=viewer, role="viewer"),
            Row(user_id=manager, role="manager"),
        ])
        asyncio.run(notify_team(session, actor, "notif.team.job_posted", permission="chat"))
        recipients = {n.user_id for n in session.added}
        assert recipients == {manager}

    def test_no_permission_notifies_all_non_actor_members(self):
        actor = uuid.uuid4()
        org_id = uuid.uuid4()
        a, b = uuid.uuid4(), uuid.uuid4()
        session = FakeTeamSession(org_id=org_id, members=[
            Row(user_id=actor, role="owner"),
            Row(user_id=a, role="viewer"),
            Row(user_id=b, role="manager"),
        ])
        asyncio.run(notify_team(session, actor, "notif.team.job_posted"))
        recipients = {n.user_id for n in session.added}
        assert recipients == {a, b}

    def test_solo_employer_no_org_is_noop(self):
        session = FakeTeamSession(org_id=None, members=[])
        asyncio.run(notify_team(session, uuid.uuid4(), "notif.team.job_posted"))
        assert session.added == []

    def test_never_raises_on_execute_failure(self):
        class RaisingSession(FakeSession):
            async def execute(self, stmt):
                raise RuntimeError("db down")

        asyncio.run(notify_team(RaisingSession(), uuid.uuid4(), "notif.team.job_posted"))
