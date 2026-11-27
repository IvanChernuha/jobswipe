// The job check on the website's Jobs page (user 2026-11-26): however a job
// is added, if it's missing what it needs, or the file was wrong, the employer
// is told and asked to check before it goes live.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../../lib/api'
import Jobs from '../Jobs'

const auth = vi.hoisted(() => ({ token: 'tok' }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ session: { access_token: auth.token }, role: 'employer' }) }))
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  getJobPostings: vi.fn(),
  getPlan: vi.fn(),
  getTags: vi.fn(),
  getComeetStatus: vi.fn(),
  createJobPosting: vi.fn(),
  parseJobFiles: vi.fn(),
}))
const m = vi.mocked(api)

const IN_A_MONTH = new Date(Date.now() + 30 * 86400000).toISOString()
const job = (title: string, extra: Partial<api.JobPosting> = {}): api.JobPosting => ({
  id: title, employer_id: 'e1', title, description: 'Test our mobile app before every release, write test plans.',
  location: 'Tel Aviv', salary_min: 12000, salary_max: 15000, skills_required: [], remote: false, active: true,
  created_at: '2026-11-26T10:00:00Z', expires_at: IN_A_MONTH, min_experience_years: null, tags: [],
  swipe_count: 0, like_count: 0, match_count: 0, issues: [], ...extra,
})
const parsed = (extra: Partial<api.ParsedJobFile> = {}): api.ParsedJobFile => ({
  filename: 'qa.pdf', title: 'Junior QA Engineer', description: 'Test our mobile app before every release, write test plans.',
  location: 'Tel Aviv', remote: false, salary_min: 12000, salary_max: 15000, min_experience_years: 1,
  required_tag_ids: ['t1'], preferred_tag_ids: [], tag_ids: [], required_tags: ['QA'], preferred_tags: [], nice_tags: [],
  error: null, ...extra,
} as api.ParsedJobFile)

const page = () => render(<MemoryRouter><Jobs /></MemoryRouter>)
// The form's submit button (the empty page has a "Create Job" button of its own).
const submit = () => within(document.querySelector('form')!).getByRole('button', { name: 'Create Job' })

async function uploadFiles(results: api.ParsedJobFile[]) {
  m.parseJobFiles.mockResolvedValue(results)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: results.map((r) => new File(['x'], r.filename)) } })
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.token = 'tok'
  m.getJobPostings.mockResolvedValue([])
  m.getPlan.mockResolvedValue({ plan: 'pro', pro_until: null, shared_with_team: false, can_redeem: true, live_jobs: 0, free_live_jobs: 1 })
  m.getTags.mockResolvedValue([])
  m.getComeetStatus.mockRejectedValue(new Error('not used here'))
})

describe('the job check', () => {
  it('a new job lists what it still needs, and Create waits until it is complete', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: /New Job/ }))
    expect(screen.getByText('Before it can go live:')).toBeInTheDocument()
    expect(screen.getByText('Add a description (a few sentences about the job)')).toBeInTheDocument()
    expect(screen.getByText('Add at least one skill')).toBeInTheDocument()
    expect(submit()).toBeDisabled()
  })

  it('a file read by the AI opens the form to check; a complete one can be created', async () => {
    m.createJobPosting.mockResolvedValue(job('Junior QA Engineer'))
    page()
    await screen.findByRole('button', { name: /New Job/ })
    await uploadFiles([parsed()])
    expect(await screen.findByDisplayValue('Junior QA Engineer')).toBeInTheDocument()
    expect(screen.getByText('Ready to go live')).toBeInTheDocument()
    fireEvent.click(submit())
    await waitFor(() => expect(m.createJobPosting).toHaveBeenCalled())
  })

  it('a wrong file (e.g. a CV) says so and creates nothing', async () => {
    page()
    await screen.findByRole('button', { name: /New Job/ })
    await uploadFiles([{ filename: 'my-cv.pdf', error: 'This looks like a CV, not a job post. Check that you picked the right file or text.' } as api.ParsedJobFile])
    expect(await screen.findByText(/This looks like a CV/)).toBeInTheDocument()
    expect(m.createJobPosting).not.toHaveBeenCalled()
  })

  it('several files: incomplete ones must be edited first, and "Create all" skips them', async () => {
    page()
    await screen.findByRole('button', { name: /New Job/ })
    await uploadFiles([
      parsed({ filename: 'a.pdf', title: 'QA one' }), parsed({ filename: 'b.pdf', title: 'QA two' }),
      parsed({ filename: 'c.pdf', title: 'No skills', required_tag_ids: [], required_tags: [] }),
    ])
    expect(await screen.findByText('No skills')).toBeInTheDocument()
    expect(screen.getByText('Add at least one skill')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Create All (2 jobs)' })).toBeInTheDocument()
  })

  it('the job list marks jobs that need a check, and says why', async () => {
    m.getJobPostings.mockResolvedValue([
      job('Complete job'),
      job('Imported from Comeet', { active: false, source: 'comeet', held_reason: 'incomplete', issues: [{ code: 'skills', level: 'must' }] }),
    ])
    page()
    expect(await screen.findByText('Complete job')).toBeInTheDocument()
    expect(screen.getAllByText('Needs a check')).toHaveLength(1)
    expect(screen.getByText(/Imported, but missing something/)).toBeInTheDocument()
    expect(screen.getByText('Add at least one skill')).toBeInTheDocument()
  })

  it('salaries are shekels per month', async () => {
    m.getJobPostings.mockResolvedValue([job('Complete job')])
    page()
    expect(await screen.findByText('₪12k – ₪15k')).toBeInTheDocument()
  })

  // The login refreshes when a phone comes back from another app (e.g. from
  // Comeet). Reloading the list must not blank the page: that closed popups.
  it('reloading the list keeps the page (and any open popup) on screen', async () => {
    m.getJobPostings.mockResolvedValue([job('Complete job')])
    const view = page()
    expect(await screen.findByText('Complete job')).toBeInTheDocument()
    m.getJobPostings.mockReturnValue(new Promise(() => {}))
    auth.token = 'tok-refreshed'
    view.rerender(<MemoryRouter><Jobs /></MemoryRouter>)
    await waitFor(() => expect(m.getJobPostings).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Complete job')).toBeInTheDocument()
  })
})
