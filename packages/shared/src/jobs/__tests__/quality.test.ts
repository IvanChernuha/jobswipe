// The job check (user 2026-11-26), the forms' copy of backend
// services/job_quality.py: same rules, same codes, same cases as
// backend/tests/test_job_quality.py. Must have before going live: a title, a
// real description, a location (or remote), a skill. Suggestions: must-have
// skills, a salary.
import { describe, expect, it } from 'vitest'
import { blocking, jobIssues, shekels, type JobCheckInput } from '../index'

const COMPLETE: JobCheckInput = {
  title: 'Junior QA Engineer', description: 'Test our mobile app before every release, write test plans.',
  location: 'Tel Aviv', remote: false, skillCount: 3, requiredSkillCount: 1, salaryMin: 12000, salaryMax: 15000,
}
const codes = (input: JobCheckInput) => jobIssues(input).map((i) => [i.code, i.level])

describe('jobIssues', () => {
  it('a complete job has no issues', () => {
    expect(jobIssues(COMPLETE)).toEqual([])
  })

  it('each must-have', () => {
    expect(codes({ ...COMPLETE, title: '  ' })).toEqual([['title', 'must']])
    expect(codes({ ...COMPLETE, description: 'Join us!' })).toEqual([['description', 'must']])
    expect(codes({ ...COMPLETE, location: '' })).toEqual([['location', 'must']])
    expect(codes({ ...COMPLETE, skillCount: 0, requiredSkillCount: 0 })).toEqual([['skills', 'must']])
  })

  it('remote jobs need no location', () => {
    expect(jobIssues({ ...COMPLETE, location: '', remote: true })).toEqual([])
  })

  it('suggestions do not block', () => {
    const issues = jobIssues({ ...COMPLETE, requiredSkillCount: 0, salaryMin: 0, salaryMax: null })
    expect(issues.map((i) => [i.code, i.level])).toEqual([['required_skills', 'should'], ['salary', 'should']])
    expect(blocking(issues)).toEqual([])
  })

  it('an empty job is missing all four must-haves', () => {
    const issues = jobIssues({ title: '', description: '', location: '', remote: false, skillCount: 0, requiredSkillCount: 0 })
    expect(blocking(issues).map((i) => i.code)).toEqual(['title', 'description', 'location', 'skills'])
  })
})

it('salaries are shekels per month', () => {
  expect(shekels(15000)).toBe('₪15k')
  expect(shekels(22500)).toBe('₪23k')
})
