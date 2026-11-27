/**
 * The job check (user 2026-11-26): what a job needs before it can go live,
 * however it was added. The forms' copy of backend services/job_quality.py:
 * keep the rules and codes in step (both have tests with the same cases).
 * Texts: i18n `jobCheck.<code>`.
 */
export type JobIssueCode = 'title' | 'description' | 'location' | 'skills' | 'required_skills' | 'salary'

export interface JobIssue {
  code: JobIssueCode
  /** "must" blocks going live; "should" is a suggestion. */
  level: 'must' | 'should'
}

export interface JobCheckInput {
  title?: string | null
  description?: string | null
  location?: string | null
  remote?: boolean | null
  skillCount: number
  requiredSkillCount: number
  salaryMin?: number | null
  salaryMax?: number | null
}

/** Characters: "Join us!" isn't a job description. */
export const MIN_DESCRIPTION = 30

export function jobIssues(job: JobCheckInput): JobIssue[] {
  const issues: JobIssue[] = []
  if (!(job.title ?? '').trim()) issues.push({ code: 'title', level: 'must' })
  if ((job.description ?? '').trim().length < MIN_DESCRIPTION) issues.push({ code: 'description', level: 'must' })
  if (!(job.location ?? '').trim() && !job.remote) issues.push({ code: 'location', level: 'must' })
  if (job.skillCount <= 0) issues.push({ code: 'skills', level: 'must' })
  else if (job.requiredSkillCount <= 0) issues.push({ code: 'required_skills', level: 'should' })
  if (!job.salaryMin && !job.salaryMax) issues.push({ code: 'salary', level: 'should' })
  return issues
}

export const blocking = (issues: JobIssue[]): JobIssue[] => issues.filter((i) => i.level === 'must')

/** Salaries are shekels per month: 15000 → "₪15k". */
export const shekels = (n: number): string => `₪${Math.round(n / 1000)}k`
