"""best_job_score: pick the single best job for a worker (employer feed)."""
from app.services.scoring import best_job_score


def job(jid, title, tags, required=(), preferred=(), created="2026-10-01"):
    return {"id": jid, "title": title, "tags": set(tags), "required": set(required),
            "preferred": set(preferred), "created_at": created}


def test_no_jobs_gives_none():
    assert best_job_score({"a"}, []) is None


def test_picks_highest_percentage_and_names_the_job():
    jobs = [job("j1", "Frontend", {"a", "b", "c", "d"}), job("j2", "AI", {"a", "b"})]
    assert best_job_score({"a", "b"}, jobs) == {
        "matched": 2, "total": 2, "percentage": 100, "job_id": "j2", "job_title": "AI",
    }


def test_skips_jobs_whose_required_tags_are_missing():
    jobs = [job("j1", "Needs k8s", {"a", "k8s"}, required={"k8s"}), job("j2", "Open", {"a", "x", "y", "z"})]
    assert best_job_score({"a"}, jobs)["job_id"] == "j2"


def test_skips_jobs_with_preferred_tags_and_no_overlap():
    jobs = [job("j1", "Prefers docker", {"a", "docker"}, preferred={"docker"}), job("j2", "Open", {"a", "b"})]
    assert best_job_score({"a"}, jobs)["job_id"] == "j2"


def test_returns_none_when_worker_qualifies_for_no_job():
    jobs = [job("j1", "Needs k8s", {"k8s"}, required={"k8s"})]
    assert best_job_score({"a"}, jobs) is None


def test_tie_on_percentage_prefers_more_matched_tags():
    jobs = [job("j1", "Small", {"a", "b"}), job("j2", "Big", {"a", "b", "c", "d"})]
    assert best_job_score({"a", "c"}, jobs)["job_id"] == "j2"  # both 50%, 2 > 1 matched


def test_full_tie_prefers_newest_job():
    jobs = [job("old", "Old", {"a", "b"}, created="2026-09-01"), job("new", "New", {"a", "b"}, created="2026-10-20")]
    assert best_job_score({"a"}, jobs)["job_id"] == "new"


def test_job_without_tags_scores_zero_but_counts():
    assert best_job_score({"a"}, [job("j1", "No tags", set())]) == {
        "matched": 0, "total": 0, "percentage": 0, "job_id": "j1", "job_title": "No tags",
    }
