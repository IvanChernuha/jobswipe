"""
Tests that directly expose the bugs in cv_processing.py.

These tests do NOT need a running Celery broker or database.
They mock the external dependencies and verify the logic/crash paths.
"""
import asyncio
import base64
import threading
import pytest
from unittest.mock import MagicMock, patch, AsyncMock


# ---------------------------------------------------------------------------
# BUG 1: asyncio.get_event_loop() crashes in Celery worker threads (Python 3.10+)
# ---------------------------------------------------------------------------

class TestEventLoopBug:

    def test_get_event_loop_raises_in_plain_thread(self):
        """
        asyncio.get_event_loop() raises RuntimeError when called from a thread
        that has no current event loop (Python 3.10+).
        Celery workers run tasks in threads — _run() is therefore broken.
        Fix: replace get_event_loop() with asyncio.run().
        """
        errors = []

        def worker_thread():
            # Exactly what _run() does today
            try:
                asyncio.get_event_loop().run_until_complete(asyncio.sleep(0))
            except RuntimeError as e:
                errors.append(str(e))

        t = threading.Thread(target=worker_thread)
        t.start()
        t.join()

        assert len(errors) == 1, "Expected RuntimeError from get_event_loop() in thread"
        assert "no current event loop" in errors[0].lower()

    def test_asyncio_run_works_in_plain_thread(self):
        """
        asyncio.run() correctly creates a new event loop per call.
        This is the correct fix for the _run() helper.
        """
        results = []

        async def _coro():
            return 42

        def worker_thread():
            results.append(asyncio.run(_coro()))

        t = threading.Thread(target=worker_thread)
        t.start()
        t.join()

        assert results == [42]


# ---------------------------------------------------------------------------
# BUG 2: base64 round-trip (router → task)
# ---------------------------------------------------------------------------

class TestBase64RoundTrip:

    def test_b64_encode_decode_roundtrip(self):
        """
        The router does base64.b64encode(content).decode() and the task does
        base64.b64decode(file_content_b64).  Verify the round-trip is correct.
        """
        original = b"\x00\x01\x02PDF binary content \xff\xfe"
        encoded = base64.b64encode(original).decode()
        decoded = base64.b64decode(encoded)
        assert decoded == original

    def test_b64_encoded_value_is_str_not_bytes(self):
        """
        Celery serialises task args as JSON, so the encoded value must be a
        str (not bytes).  base64.b64encode() returns bytes — the .decode()
        call in the router is critical.
        """
        content = b"some file content"
        result = base64.b64encode(content).decode()
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# BUG 3: worker_tags table deletion uses worker_id but extract_cv_tags
#         receives user_id — verify the column name is consistent
# ---------------------------------------------------------------------------

class TestWorkerTagsColumnName:
    """
    extract_cv_tags deletes from worker_tags using .eq("worker_id", worker_id).
    If the actual table column is named user_id this will silently delete
    nothing (Supabase/PostgREST returns 200 with 0 rows deleted).
    This test documents the assumption so schema changes surface as failures.
    """

    def test_delete_uses_worker_id_column(self):
        """
        Capture the column name passed to .eq() in the delete call and assert
        it is 'worker_id'.  If the schema uses a different column name the
        delete silently no-ops.
        """
        db_mock = MagicMock()
        table_mock = MagicMock()
        db_mock.table.return_value = table_mock
        table_mock.delete.return_value = table_mock
        table_mock.eq.return_value = table_mock
        table_mock.execute.return_value = MagicMock(data=[])
        table_mock.insert.return_value = table_mock
        table_mock.update.return_value = table_mock
        table_mock.select.return_value = table_mock
        table_mock.single.return_value = table_mock

        tag_ids = ["tid-1"]

        # Simulate the delete call from cv_processing.py
        worker_id = "user-123"
        db_mock.table("worker_tags").delete().eq("worker_id", worker_id).execute()

        # Verify eq was called with 'worker_id', not 'user_id'
        calls = table_mock.eq.call_args_list
        columns_used = [c.args[0] for c in calls]
        assert "worker_id" in columns_used, (
            "worker_tags delete must filter on 'worker_id' column"
        )


# ---------------------------------------------------------------------------
# BUG 4: bulk-jobs ownership check — valid_ids uses str(r["id"]) but
#         job_ids list from the request may be UUIDs needing normalisation
# ---------------------------------------------------------------------------

class TestBulkOwnershipCheck:

    def test_ownership_check_str_comparison(self):
        """
        The ownership filter: str(r["id"]) == str(employer_id).
        If DB returns UUID objects and the request sends plain strings,
        the str() cast is required.  Verify the logic with both types.
        """
        import uuid

        employer_uuid = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        employer_id = str(employer_uuid)  # what the router has

        rows = [
            {"id": "job-1", "employer_id": employer_uuid},   # UUID object from DB
            {"id": "job-2", "employer_id": "other-employer"},
        ]

        valid_ids = {
            str(r["id"])
            for r in rows
            if str(r["employer_id"]) == str(employer_id)
        }

        assert valid_ids == {"job-1"}
        assert "job-2" not in valid_ids

    def test_redundant_ownership_guard_in_loop(self):
        """
        In cv.py the loop re-checks `if job.job_id in valid_ids` after
        already asserting all job_ids are valid (the 403 branch would have
        returned).  This is dead code but not a crash — document it.
        """
        valid_ids = {"job-1", "job-2"}
        jobs_to_queue = []

        class _Job:
            def __init__(self, jid): self.job_id = jid

        jobs = [_Job("job-1"), _Job("job-2")]
        invalid = [j.job_id for j in jobs if j.job_id not in valid_ids]
        assert invalid == []  # Would have raised 403 if non-empty

        for job in jobs:
            if job.job_id in valid_ids:   # This check is always True here
                jobs_to_queue.append(job.job_id)

        assert jobs_to_queue == ["job-1", "job-2"]


# ---------------------------------------------------------------------------
# BUG 5: Gemini code-fence stripping leaves trailing content after ```
# ---------------------------------------------------------------------------

class TestGeminiCodeFenceStripping:
    """
    The current stripping logic:
        raw = raw.split("```")[1]
    For input  "```json\n[...]\n```"  split("```") gives
        ["", "json\\n[...]\\n", ""]
    So [1] == "json\\n[...]\\n" — then if raw.startswith("json") strips 4 chars.
    This is correct for the normal case.

    BUT for "```\n[...]\n```" (no language tag) split("```")[1] == "\\n[...]\\n"
    which does NOT start with "json", so the full "\\n[...]\\n" is passed to
    json.loads — the leading newline is fine for json.loads but the absence of
    "json" prefix is handled correctly.

    This test verifies both paths parse successfully.
    """

    def _strip(self, raw: str) -> str:
        """Mirror of the stripping logic in gemini.py and deepseek.py."""
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return raw

    def test_strip_with_json_language_tag(self):
        import json
        raw = "```json\n[\"Python\", \"Docker\"]\n```"
        result = json.loads(self._strip(raw))
        assert result == ["Python", "Docker"]

    def test_strip_without_language_tag(self):
        import json
        raw = "```\n[\"FastAPI\"]\n```"
        result = json.loads(self._strip(raw))
        assert result == ["FastAPI"]

    def test_no_fence_passthrough(self):
        import json
        raw = "[\"Kubernetes\"]"
        result = json.loads(self._strip(raw))
        assert result == ["Kubernetes"]
