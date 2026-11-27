"""The job check: what a job needs before it can go live, whichever way it
was added (form, "Fill with AI", a file, Comeet). User request 2026-11-26.

"must"   blocks going live: title, description, location (or remote), a skill.
"should" is a suggestion: must-have skills, a salary.
The same rules and codes are in packages/shared/src/jobs (jobIssues) for the
forms; keep the two in step (both have tests with the same cases).
"""

MIN_DESCRIPTION = 30  # characters: "Join us!" isn't a job description

_PHRASES = {
    "title": "a title",
    "description": "a description (a few sentences)",
    "location": "a location (or mark it remote)",
    "skills": "at least one skill",
}


def job_issues(*, title, description, location, remote, skill_count: int, required_skill_count: int,
               salary_min, salary_max) -> list[dict]:
    issues: list[dict] = []

    def add(code: str, level: str) -> None:
        issues.append({"code": code, "level": level})

    if not (title or "").strip():
        add("title", "must")
    if len((description or "").strip()) < MIN_DESCRIPTION:
        add("description", "must")
    if not (location or "").strip() and not remote:
        add("location", "must")
    if skill_count <= 0:
        add("skills", "must")
    elif required_skill_count <= 0:
        add("required_skills", "should")
    if not (salary_min or 0) and not (salary_max or 0):
        add("salary", "should")
    return issues


def blocking(issues: list[dict]) -> list[dict]:
    return [i for i in issues if i["level"] == "must"]


def missing_message(issues: list[dict]) -> str:
    """One sentence listing what's missing, for a 422 the clients show as is."""
    parts = [_PHRASES[i["code"]] for i in blocking(issues)]
    return "Before this job can go live, add: " + ", ".join(parts) + "."
