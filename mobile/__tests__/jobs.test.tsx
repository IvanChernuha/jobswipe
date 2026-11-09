// P7 (early): the employer's jobs (web Jobs.tsx). List with status and stats,
// post a job with skills (must-have or nice-to-have), edit, switch off/on,
// delete, and the server's refusal (e.g. free plan: one live job) is shown.
import { Alert } from 'react-native'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
import * as DocumentPicker from 'expo-document-picker'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getJobPostings: jest.fn(),
  createJobPosting: jest.fn(),
  updateJobPosting: jest.fn(),
  toggleJobActive: jest.fn(),
  deleteJobPosting: jest.fn(),
  getTags: jest.fn(),
  parseJobText: jest.fn(),
  parseJobFiles: jest.fn(),
}))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

const mocked = api as jest.Mocked<typeof api>
const picker = DocumentPicker as jest.Mocked<typeof DocumentPicker>
const APP = './src/app'
const IN_A_MONTH = new Date(Date.now() + 30 * 86400000).toISOString()

const react = { id: 't1', name: 'React', category: 'framework' }
const docker = { id: 't4', name: 'Docker', category: 'tool' }
const ts = { id: 't2', name: 'TypeScript', category: 'language' }
const python = { id: 't3', name: 'Python', category: 'language' }

const job = (id: string, title: string, extra: Partial<api.JobPosting> = {}): api.JobPosting => ({
  id, employer_id: 'id-employer', title, description: 'Build our app', location: 'Tel Aviv',
  salary_min: 15000, salary_max: 22000, skills_required: [], remote: false, active: true,
  created_at: '2026-11-01T10:00:00Z', expires_at: IN_A_MONTH, min_experience_years: null,
  tags: [{ ...react, requirement: 'required' }, { ...ts, requirement: 'nice' }],
  swipe_count: 40, like_count: 12, match_count: 3, ...extra,
})

// What the AI makes of a posting (the server's parse-job-text answer).
const aiReading: api.ParsedJob = {
  title: 'Junior React Developer', description: 'Rewritten by AI', location: 'Tel Aviv', remote: true,
  salary_min: 14000, salary_max: 18000, min_experience_years: 1,
  required_tag_ids: ['t1'], required_tags: ['React'],
  preferred_tag_ids: ['t2'], preferred_tags: ['TypeScript'],
  tag_ids: ['t4'], nice_tags: ['Docker'],
}
const POSTING = 'We are a small Tel Aviv startup looking for a junior React developer who knows Docker.'

async function open(url: string) {
  fakeSupabase.__reset(sessionFor('employer'))
  return renderRouter(APP, { initialUrl: url })
}

const press = async (label: string) => act(async () => fireEvent.press(screen.getByRole('button', { name: label })))
const type = async (label: string, text: string) => act(async () => fireEvent.changeText(screen.getByLabelText(label), text))
const inJob = (id: string) => within(screen.getByTestId(`job-${id}`))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getJobPostings.mockResolvedValue([job('j1', 'Frontend Engineer'), job('j2', 'Data Analyst', { active: false })])
  mocked.getTags.mockResolvedValue([react, ts, python, docker])
  mocked.parseJobText.mockResolvedValue(aiReading)
  mocked.createJobPosting.mockImplementation(async (_t, data) => job('new', data.title))
  mocked.updateJobPosting.mockImplementation(async (_t, id, data) => job(id, data.title ?? 'x'))
  mocked.toggleJobActive.mockImplementation(async (_t, id) => job(id, 'Frontend Engineer', { active: false }))
  mocked.deleteJobPosting.mockResolvedValue(undefined)
})

describe('jobs list', () => {
  it('shows each job with its status, must-have skills and numbers', async () => {
    await open('/jobs')
    expect(await screen.findByText('Frontend Engineer')).toBeOnTheScreen()
    expect(inJob('j1').getByText('React')).toBeOnTheScreen()
    expect(inJob('j1').getByText('12')).toBeOnTheScreen() // likes
    expect(inJob('j2').getByText('Inactive')).toBeOnTheScreen()
    expect(mocked.getJobPostings).toHaveBeenCalledWith('token-employer')
  })

  it('with no jobs, invites you to post the first one', async () => {
    mocked.getJobPostings.mockResolvedValue([]) // the feed tab loads jobs too (job switcher)
    const router = await open('/jobs')
    expect(await screen.findByText('No job postings yet')).toBeOnTheScreen()
    await press('Create Job')
    await waitFor(() => expect(router.getPathname()).toBe('/job/new'))
  })

  it('New Job opens the form', async () => {
    const router = await open('/jobs')
    await screen.findByText('Frontend Engineer')
    await press('New Job')
    await waitFor(() => expect(router.getPathname()).toBe('/job/new'))
  })

  it('tapping a job opens it for editing', async () => {
    const router = await open('/jobs')
    await screen.findByText('Frontend Engineer')
    await act(async () => fireEvent.press(screen.getByText('Frontend Engineer')))
    await waitFor(() => expect(router.getPathname()).toBe('/job/j1'))
  })

  it('deactivate switches a job off', async () => {
    await open('/jobs')
    await screen.findByText('Frontend Engineer')
    await act(async () => fireEvent.press(inJob('j1').getByRole('button', { name: 'Deactivate' })))
    expect(mocked.toggleJobActive).toHaveBeenCalledWith('token-employer', 'j1')
    expect(await inJob('j1').findByText('Inactive')).toBeOnTheScreen()
  })

  it('delete asks first, then removes the job', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    await open('/jobs')
    await screen.findByText('Frontend Engineer')
    await act(async () => fireEvent.press(inJob('j1').getByRole('button', { name: 'Delete' })))
    expect(alert).toHaveBeenCalled()
    expect(mocked.deleteJobPosting).toHaveBeenCalledWith('token-employer', 'j1')
    await waitFor(() => expect(screen.queryByText('Frontend Engineer')).toBeNull())
    alert.mockRestore()
  })
})

describe('posting a job', () => {
  it('needs a title before it can be created', async () => {
    await open('/job/new')
    expect(await screen.findByRole('button', { name: 'Create Job' })).toBeDisabled()
    await type('Job title', 'React Developer')
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeEnabled()
  })

  it('creates the job with its skills and goes back to the list', async () => {
    const router = await open('/jobs')
    await screen.findByText('Frontend Engineer')
    await press('New Job')
    await type('Job title', 'React Developer')
    await type('Description', 'Build our web app')
    await type('Location', 'Tel Aviv')
    await type('Min salary (₪/month)', '15000')
    await type('Max salary (₪/month)', '22000')
    await type('Search skills (e.g. React, Python, AWS)...', 'rea')
    await press('React')
    await type('Search skills (e.g. React, Python, AWS)...', 'type')
    await press('TypeScript')
    await act(async () => fireEvent(screen.getByRole('switch', { name: 'Must-have: React' }), 'valueChange', true))
    await press('Create Job')
    expect(mocked.createJobPosting).toHaveBeenCalledWith('token-employer', expect.objectContaining({
      title: 'React Developer', description: 'Build our web app', location: 'Tel Aviv',
      salary_min: 15000, salary_max: 22000, remote: false, min_experience_years: null,
      required_tag_ids: ['t1'], tag_ids: ['t2'], expires_in_days: 30,
    }))
    await waitFor(() => expect(router.getPathname()).toBe('/jobs'))
  })

  it("shows the server's reason when it refuses", async () => {
    mocked.createJobPosting.mockRejectedValueOnce(new Error('Free plan allows 1 live job. Upgrade to Pro for more.'))
    await open('/job/new')
    await type('Job title', 'Second job')
    await press('Create Job')
    expect(await screen.findByText('Free plan allows 1 live job. Upgrade to Pro for more.')).toBeOnTheScreen()
  })

  it('a chosen skill can be removed again', async () => {
    await open('/job/new')
    await type('Search skills (e.g. React, Python, AWS)...', 'py')
    await press('Python')
    await press('Remove Python')
    expect(screen.queryByRole('switch', { name: 'Must-have: Python' })).toBeNull()
  })
})

describe('editing a job', () => {
  it('opens with the saved details and saves changes', async () => {
    const router = await open('/jobs')
    await screen.findByText('Frontend Engineer')
    await act(async () => fireEvent.press(screen.getByText('Frontend Engineer')))
    expect(await screen.findByDisplayValue('Frontend Engineer')).toBeOnTheScreen()
    expect(screen.getByRole('switch', { name: 'Must-have: React' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Must-have: TypeScript' })).not.toBeChecked()
    await type('Job title', 'Senior Frontend Engineer')
    await press('Save Changes')
    expect(mocked.updateJobPosting).toHaveBeenCalledWith('token-employer', 'j1', expect.objectContaining({
      title: 'Senior Frontend Engineer', required_tag_ids: ['t1'], tag_ids: ['t2'],
    }))
    await waitFor(() => expect(router.getPathname()).toBe('/jobs'))
  })
})

describe('AI reads the posting', () => {
  it('Fill with AI fills the title, details and skills from the description', async () => {
    await open('/job/new')
    await type('Description', POSTING)
    await press('Fill with AI')
    expect(mocked.parseJobText).toHaveBeenCalledWith('token-employer', POSTING)
    expect(await screen.findByDisplayValue('Junior React Developer')).toBeOnTheScreen()
    expect(screen.getByLabelText('Location')).toHaveDisplayValue('Tel Aviv')
    expect(screen.getByLabelText('Min salary (₪/month)')).toHaveDisplayValue('14000')
    expect(screen.getByLabelText('Min experience (years)')).toHaveDisplayValue('1')
    expect(screen.getByRole('switch', { name: 'Remote job' })).toBeChecked()
    // Must-have stays must-have; "at least one of" and nice-to-have become normal skills.
    expect(screen.getByRole('switch', { name: 'Must-have: React' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Must-have: TypeScript' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Must-have: Docker' })).not.toBeChecked()
    expect(screen.getByText('AI added 3 skills. Check them before saving.')).toBeOnTheScreen()
    // Your own description is kept, not replaced by the AI's version.
    expect(screen.getByLabelText('Description')).toHaveDisplayValue(POSTING)
  })

  it('keeps what you already typed and skills you already chose', async () => {
    await open('/job/new')
    await type('Job title', 'Frontend Dev')
    await type('Search skills (e.g. React, Python, AWS)...', 'rea')
    await press('React')
    await type('Description', POSTING)
    await press('Fill with AI')
    await screen.findByText('AI added 2 skills. Check them before saving.')
    expect(screen.getByLabelText('Job title')).toHaveDisplayValue('Frontend Dev')
    expect(screen.getAllByRole('switch', { name: 'Must-have: React' })).toHaveLength(1)
    expect(mocked.parseJobText).toHaveBeenCalledWith('token-employer', `Frontend Dev\n\n${POSTING}`)
  })

  it('needs a few words about the job first', async () => {
    await open('/job/new')
    expect(await screen.findByRole('button', { name: 'Fill with AI' })).toBeDisabled()
    await type('Description', 'React dev')
    expect(screen.getByRole('button', { name: 'Fill with AI' })).toBeDisabled()
    await type('Description', POSTING)
    expect(screen.getByRole('button', { name: 'Fill with AI' })).toBeEnabled()
  })

  it("says why when the AI can't help", async () => {
    mocked.parseJobText.mockRejectedValueOnce(new Error('Daily AI limit reached. Try again tomorrow.'))
    await open('/job/new')
    await type('Description', POSTING)
    await press('Fill with AI')
    expect(await screen.findByText('Daily AI limit reached. Try again tomorrow.')).toBeOnTheScreen()
  })

  it('From a file sends the picked PDF to the AI and fills the form', async () => {
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false, assets: [{ uri: 'file:///cache/job.pdf', name: 'job.pdf', mimeType: 'application/pdf', lastModified: 0 }],
    } as never)
    mocked.parseJobFiles.mockResolvedValueOnce([{ ...aiReading, filename: 'job.pdf', error: null }])
    await open('/job/new')
    await press('From a file')
    expect(mocked.parseJobFiles).toHaveBeenCalledWith('token-employer', [
      { uri: 'file:///cache/job.pdf', name: 'job.pdf', type: 'application/pdf' },
    ])
    expect(await screen.findByDisplayValue('Junior React Developer')).toBeOnTheScreen()
    // A file has no typed description yet: the AI's one is used.
    expect(screen.getByLabelText('Description')).toHaveDisplayValue('Rewritten by AI')
  })

  it('cancelling the file picker changes nothing', async () => {
    picker.getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never)
    await open('/job/new')
    await press('From a file')
    expect(mocked.parseJobFiles).not.toHaveBeenCalled()
  })
})
