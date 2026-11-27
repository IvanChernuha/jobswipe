// Jobs tab: import jobs from Comeet (OpenProject #3297). "Brain-dead, just tap
// and go": one paste of the UID + Token, then the jobs come in by themselves
// and stay in sync. Shown on the empty Jobs screen too, where it helps most.
import { Alert, Linking } from 'react-native'
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
import { usePolling } from '../src/lib/usePolling'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getJobPostings: jest.fn(),
  getComeetStatus: jest.fn(),
  connectComeet: jest.fn(),
  syncComeet: jest.fn(),
  disconnectComeet: jest.fn(),
}))
// The timer itself is tested in usePolling.test; here the test runs the poll.
jest.mock('../src/lib/usePolling', () => ({ usePolling: jest.fn() }))

const mocked = api as jest.Mocked<typeof api>
const polling = usePolling as jest.Mock
const APP = './src/app'
const IN_A_MONTH = new Date(Date.now() + 30 * 86400000).toISOString()

const connected: api.ComeetStatus = {
  connected: true, company_name: 'Careers API Sandbox', status: 'connected',
  job_count: 3, live_count: 3, last_synced_at: '2026-11-26T10:00:00Z', last_error: null,
}
const job: api.JobPosting = {
  id: 'j1', employer_id: 'id-employer', title: 'Android Developer', description: '', location: 'Brooklyn, US',
  salary_min: 0, salary_max: 0, skills_required: [], remote: false, active: true,
  created_at: '2026-11-26T10:00:00Z', expires_at: IN_A_MONTH, min_experience_years: 0, tags: [],
  swipe_count: 0, like_count: 0, super_like_count: 0, match_count: 0,
}

async function openJobs() {
  fakeSupabase.__reset(sessionFor('employer'))
  await renderRouter(APP, { initialUrl: '/jobs' })
}

/** Runs the latest enabled poll, as if 3 seconds passed. */
async function poll() {
  const enabled = polling.mock.calls.filter((c) => c[2] === true)
  expect(enabled.length).toBeGreaterThan(0)
  await act(async () => { await enabled[enabled.length - 1][0]() })
}

const press = async (name: string) => act(async () => fireEvent.press(await screen.findByRole('button', { name })))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getJobPostings.mockResolvedValue([])
})

describe('Import from Comeet', () => {
  it('on the empty Jobs screen: one paste connects, imports and shows the jobs', async () => {
    mocked.getComeetStatus.mockResolvedValueOnce({ connected: false }).mockResolvedValue(connected)
    mocked.connectComeet.mockResolvedValue({ company_name: 'Careers API Sandbox', found: 3, status: 'importing' })
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    await openJobs()

    await press('Import from Comeet')
    expect(screen.getByText(/Company Settings → Careers Website/)).toBeOnTheScreen()
    await press('Open Comeet settings')
    expect(openURL).toHaveBeenCalledWith('https://app.comeet.co/app/company/settings/careers')

    await act(async () => fireEvent.changeText(screen.getByLabelText('UID and Token'), 'UID: E5.007\nToken: ABC'))
    await press('Connect')
    expect(mocked.connectComeet).toHaveBeenCalledWith('token-employer', 'UID: E5.007\nToken: ABC')
    expect(await screen.findByText('Found 3 jobs at Careers API Sandbox. Importing them now…')).toBeOnTheScreen()

    mocked.getJobPostings.mockResolvedValue([job])
    await poll()
    expect(await screen.findByText('Careers API Sandbox: 3 live jobs from Comeet')).toBeOnTheScreen()
    expect(await screen.findByText('Android Developer')).toBeOnTheScreen()
  })

  it('Connect waits for a paste, and a refusal says why', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    mocked.connectComeet.mockRejectedValue(new Error("Comeet didn't accept this UID or Token."))
    await openJobs()
    await press('Import from Comeet')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    await act(async () => fireEvent.changeText(screen.getByLabelText('UID and Token'), 'E5.007 WRONG'))
    await press('Connect')
    expect(await screen.findByText("Comeet didn't accept this UID or Token.")).toBeOnTheScreen()
  })

  it('when connected: Sync now and Disconnect (asks first)', async () => {
    mocked.getJobPostings.mockResolvedValue([job])
    mocked.getComeetStatus.mockResolvedValue(connected)
    mocked.syncComeet.mockResolvedValue({ status: 'importing' })
    mocked.disconnectComeet.mockResolvedValue({ disconnected: true, jobs_switched_off: 3 })
    const alert = jest.spyOn(Alert, 'alert')
    await openJobs()

    expect(await screen.findByText('Careers API Sandbox: 3 live jobs from Comeet')).toBeOnTheScreen()
    await press('Sync now')
    expect(mocked.syncComeet).toHaveBeenCalledWith('token-employer')
    expect(await screen.findByText('Updating your jobs from Comeet…')).toBeOnTheScreen()
    await poll()

    await press('Disconnect')
    expect(alert).toHaveBeenCalledWith(
      'Disconnect', 'Disconnect Comeet? The jobs imported from it will be switched off.', expect.any(Array))
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[]
    await act(async () => { await buttons.find((b) => b.text === 'Disconnect')!.onPress!() })
    expect(mocked.disconnectComeet).toHaveBeenCalledWith('token-employer')
    expect(await screen.findByRole('button', { name: 'Import from Comeet' })).toBeOnTheScreen()
  })

  it('shows why the last sync failed', async () => {
    mocked.getJobPostings.mockResolvedValue([job])
    mocked.getComeetStatus.mockResolvedValue({ ...connected, status: 'error', last_error: "Comeet isn't answering right now." })
    await openJobs()
    expect(await screen.findByText("The last sync didn't work: Comeet isn't answering right now.")).toBeOnTheScreen()
  })
})

it('keeps working if the Comeet status cannot load', async () => {
  mocked.getComeetStatus.mockRejectedValue(new Error('Network request failed'))
  mocked.getJobPostings.mockResolvedValue([job])
  await openJobs()
  expect(await screen.findByText('Android Developer')).toBeOnTheScreen()
  await waitFor(() => expect(mocked.getComeetStatus).toHaveBeenCalled())
  expect(screen.queryByText('Import from Comeet')).toBeNull()
})
