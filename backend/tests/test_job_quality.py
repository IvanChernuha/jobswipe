"""The job check (user 2026-11-26): however a job is added (the form, "Fill
with AI", a file, Comeet), if it's missing what a job needs, or the file
wasn't a job post at all, the employer is told and asked to check.

Must have before going live: a title, a real description, a location (or
remote), and at least one skill. Suggestions that don't block: must-have
skills and a salary. The same rules live in packages/shared (jobIssues) for
the forms; the codes are shared.
"""
from app.services.job_quality import blocking, job_issues, missing_message

COMPLETE = dict(title="Junior QA Engineer", description="Test our mobile app before every release, write test plans.",
                location="Tel Aviv", remote=False, skill_count=3, required_skill_count=1,
                salary_min=12000, salary_max=15000)


def codes(issues):
    return [(i["code"], i["level"]) for i in issues]


def test_a_complete_job_has_no_issues():
    assert job_issues(**COMPLETE) == []


def test_each_must_have():
    assert codes(job_issues(**{**COMPLETE, "title": "  "})) == [("title", "must")]
    assert codes(job_issues(**{**COMPLETE, "description": "Join us!"})) == [("description", "must")]
    assert codes(job_issues(**{**COMPLETE, "location": ""})) == [("location", "must")]
    assert codes(job_issues(**{**COMPLETE, "skill_count": 0, "required_skill_count": 0})) == [("skills", "must")]


def test_remote_jobs_need_no_location():
    assert job_issues(**{**COMPLETE, "location": "", "remote": True}) == []


def test_suggestions_do_not_block():
    issues = job_issues(**{**COMPLETE, "required_skill_count": 0, "salary_min": 0, "salary_max": 0})
    assert codes(issues) == [("required_skills", "should"), ("salary", "should")]
    assert blocking(issues) == []


def test_an_empty_job_lists_everything_in_one_message():
    issues = job_issues(title="", description="", location="", remote=False, skill_count=0,
                        required_skill_count=0, salary_min=0, salary_max=0)
    assert [i["code"] for i in blocking(issues)] == ["title", "description", "location", "skills"]
    assert missing_message(issues) == (
        "Before this job can go live, add: a title, a description (a few sentences), "
        "a location (or mark it remote), at least one skill."
    )


def test_none_values_count_as_missing():
    issues = job_issues(title=None, description=None, location=None, remote=None, skill_count=0,
                        required_skill_count=0, salary_min=None, salary_max=None)
    assert len(blocking(issues)) == 4
