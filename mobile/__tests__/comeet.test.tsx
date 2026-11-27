// Jobs tab: import jobs from Comeet (OpenProject #3297). "Brain-dead, just tap
// and go": a popup with a UID box and a Token box, each with a Paste button
// (user 2026-11-27), then the jobs come in by themselves and stay in sync.
// Shown on the empty Jobs screen too, where it helps most.
import { Alert, Linking } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import { render } from '@testing-library/react-native'
import '../src/lib/i18n'
import ComeetCard from '../src/components/ComeetCard'
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
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }))
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
// The popup draft's storage (the real one is encrypted; tested in secureStorage.test).
const mockDraft = new Map<string, string>()
jest.mock('../src/lib/secureStorage', () => ({
  secureSessionStorage: {
    getItem: async (k: string) => mockDraft.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockDraft.set(k, v),
    removeItem: async (k: string) => void mockDraft.delete(k),
  },
}))
// The timer itself is tested in usePolling.test; here the test runs the poll.
jest.mock('../src/lib/usePolling', () => ({ usePolling: jest.fn() }))

const mocked = api as jest.Mocked<typeof api>
const clipboard = Clipboard.getStringAsync as jest.Mock
const browser = WebBrowser.openBrowserAsync as jest.Mock
const TOKEN = '5E7236A0BCE5E7295111B55E70BCE'
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
  // Forget any popup draft an earlier test left behind.
  mockDraft.clear()
  jest.clearAllMocks()
  mocked.getJobPostings.mockResolvedValue([])
})

describe('Import from Comeet', () => {
  it('on the empty Jobs screen: a popup with UID and Token connects, imports and shows the jobs', async () => {
    mocked.getComeetStatus.mockResolvedValueOnce({ connected: false }).mockResolvedValue(connected)
    mocked.connectComeet.mockResolvedValue({ company_name: 'Careers API Sandbox', found: 3, status: 'importing' })
    browser.mockResolvedValue({ type: 'cancel' })
    await openJobs()

    await press('Import from Comeet')
    expect(screen.getByText('Connect Comeet')).toBeOnTheScreen()
    expect(screen.getByText(/Company Settings → Careers Website/)).toBeOnTheScreen()
    expect(screen.getByText(/can't see your candidates/)).toBeOnTheScreen()
    // Opens inside the app (closes with ✕ back to the popup), not in another app.
    await press('Open Comeet settings')
    expect(browser).toHaveBeenCalledWith('https://app.comeet.co/app/company/settings/careers')
    expect(screen.getByText('Connect Comeet')).toBeOnTheScreen()

    await act(async () => fireEvent.changeText(screen.getByLabelText('UID'), 'E5.007'))
    await act(async () => fireEvent.changeText(screen.getByLabelText('Token'), TOKEN))
    await press('Connect')
    expect(mocked.connectComeet).toHaveBeenCalledWith('token-employer', `E5.007 ${TOKEN}`)
    expect(await screen.findByText('Found 3 jobs at Careers API Sandbox. Importing them now…')).toBeOnTheScreen()
    expect(screen.queryByText('Connect Comeet')).toBeNull()

    mocked.getJobPostings.mockResolvedValue([job])
    await poll()
    expect(await screen.findByText('Careers API Sandbox: 3 live jobs from Comeet')).toBeOnTheScreen()
    expect(await screen.findByText('Android Developer')).toBeOnTheScreen()
  })

  it('if the in-app browser fails, opens Comeet in the phone browser', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    browser.mockRejectedValue(new Error('no browser'))
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    await openJobs()
    await press('Import from Comeet')
    await press('Open Comeet settings')
    expect(openURL).toHaveBeenCalledWith('https://app.comeet.co/app/company/settings/careers')
  })

  it('Paste buttons fill the boxes; a copy of both fills both', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    await openJobs()
    await press('Import from Comeet')
    clipboard.mockResolvedValue(TOKEN)
    await press('Paste the UID')
    expect(screen.getByLabelText('Token').props.value).toBe(TOKEN)
    expect(screen.getByLabelText('UID').props.value).toBe('')

    clipboard.mockResolvedValue(`UID: E5.007\nToken: ${TOKEN}`)
    await press('Paste the UID')
    expect(screen.getByLabelText('UID').props.value).toBe('E5.007')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('pasting both into one box splits them; an empty clipboard says how to paste', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    await openJobs()
    await press('Import from Comeet')
    await act(async () => fireEvent.changeText(screen.getByLabelText('Token'), `E5.007 ${TOKEN}`))
    expect(screen.getByLabelText('UID').props.value).toBe('E5.007')
    expect(screen.getByLabelText('Token').props.value).toBe(TOKEN)

    clipboard.mockResolvedValue('')
    await press('Paste the UID')
    expect(screen.getByText(/Paste didn't work here/)).toBeOnTheScreen()
  })

  it('Connect waits for both boxes, and a refusal says why', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    mocked.connectComeet.mockRejectedValue(new Error("Comeet didn't accept this UID or Token."))
    await openJobs()
    await press('Import from Comeet')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    await act(async () => fireEvent.changeText(screen.getByLabelText('UID'), 'E5.007'))
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    await act(async () => fireEvent.changeText(screen.getByLabelText('Token'), 'WRONGWRONGWRONGWRONG'))
    await press('Connect')
    expect(await screen.findByText("Comeet didn't accept this UID or Token.")).toBeOnTheScreen()
    expect(screen.getByLabelText('Token').props.value).toBe('WRONGWRONGWRONGWRONG')
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

// On a phone, opening Comeet sends JobSwipe to the background, and Samsung
// phones often close it there. The popup must come back as it was.
describe('coming back from Comeet', () => {
  const card = async () => { await render(<ComeetCard key="first" token="token-employer" onJobsChanged={jest.fn()} />) }
  /** A brand-new card, as after the phone closed and reopened the app (a new key remounts it). */
  const reopen = async () => {
    await act(async () => { await screen.rerender(<ComeetCard key="again" token="token-employer" onJobsChanged={jest.fn()} />) })
  }

  it('keeps the popup and what was typed, even if the phone closed the app', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    await card()
    await press('Import from Comeet')
    await act(async () => fireEvent.changeText(screen.getByLabelText('UID'), 'E5.007'))
    await act(async () => fireEvent.changeText(screen.getByLabelText('Token'), TOKEN))
    await reopen()
    expect(await screen.findByText('Connect Comeet')).toBeOnTheScreen()
    await waitFor(() => expect(screen.getByLabelText('UID').props.value).toBe('E5.007'))
    expect(screen.getByLabelText('Token').props.value).toBe(TOKEN)
  })

  it('Cancel forgets it', async () => {
    mocked.getComeetStatus.mockResolvedValue({ connected: false })
    await card()
    await press('Import from Comeet')
    await act(async () => fireEvent.changeText(screen.getByLabelText('UID'), 'E5.007'))
    await press('Cancel')
    await reopen()
    expect(await screen.findByRole('button', { name: 'Import from Comeet' })).toBeOnTheScreen()
    expect(screen.queryByText('Connect Comeet')).toBeNull()
  })

  it('connecting forgets it', async () => {
    mocked.getComeetStatus.mockResolvedValueOnce({ connected: false }).mockResolvedValue({ connected: false })
    mocked.connectComeet.mockResolvedValue({ company_name: 'Careers API Sandbox', found: 3, status: 'importing' })
    await card()
    await press('Import from Comeet')
    await act(async () => fireEvent.changeText(screen.getByLabelText('UID'), 'E5.007'))
    await act(async () => fireEvent.changeText(screen.getByLabelText('Token'), TOKEN))
    await press('Connect')
    await reopen()
    expect(await screen.findByRole('button', { name: 'Import from Comeet' })).toBeOnTheScreen()
    expect(screen.queryByText('Connect Comeet')).toBeNull()
  })
})
