// P7 (early): the employer's jobs (web Jobs.tsx). List with status and stats,
// post a job with skills (must-have or nice-to-have), edit, switch off/on,
// delete, and the server's refusal (e.g. free plan: one live job) is shown.
import { Alert } from 'react-native'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
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
}))

const mocked = api as jest.Mocked<typeof api>
const APP = './src/app'
const IN_A_MONTH = new Date(Date.now() + 30 * 86400000).toISOString()

const react = { id: 't1', name: 'React', category: 'framework' }
const ts = { id: 't2', name: 'TypeScript', category: 'language' }
const python = { id: 't3', name: 'Python', category: 'language' }

const job = (id: string, title: string, extra: Partial<api.JobPosting> = {}): api.JobPosting => ({
  id, employer_id: 'id-employer', title, description: 'Build our app', location: 'Tel Aviv',
  salary_min: 15000, salary_max: 22000, skills_required: [], remote: false, active: true,
  created_at: '2026-11-01T10:00:00Z', expires_at: IN_A_MONTH, min_experience_years: null,
  tags: [{ ...react, requirement: 'required' }, { ...ts, requirement: 'nice' }],
  swipe_count: 40, like_count: 12, match_count: 3, ...extra,
})

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
  mocked.getTags.mockResolvedValue([react, ts, python])
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
    mocked.getJobPostings.mockResolvedValueOnce([])
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
