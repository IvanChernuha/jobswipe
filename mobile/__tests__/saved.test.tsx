// P5: saved for later (the web Bookmarks.tsx). Workers see saved jobs,
// employers see saved candidates grouped by the job they were filed under;
// each can be liked, passed or removed, and team viewers can't like.
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getBookmarks: jest.fn(),
  removeBookmark: jest.fn(),
  postSwipe: jest.fn(),
  getMyMembership: jest.fn(),
}))

const mocked = api as jest.Mocked<typeof api>
const APP = './src/app'

const base = (target_id: string, job_posting_id: string | null = null): api.SavedItem => ({
  id: `b-${target_id}`, user_id: 'me', target_id, job_posting_id, note: '',
  created_at: '2026-11-01T10:00:00Z', expires_at: '2026-12-01T10:00:00Z',
})

const savedJob = (id: string, title: string, company: string): api.SavedItem => ({
  ...base(id), job_title: title, company_name: company, location: 'Tel Aviv', salary_min: 15000, salary_max: 22000, tags: [],
})

const savedCandidate = (id: string, name: string, job: string | null): api.SavedItem => ({
  ...base(id, job), name, experience_years: 1, location: 'Haifa', tags: [],
})

async function open(role: 'worker' | 'employer') {
  fakeSupabase.__reset(sessionFor(role))
  return renderRouter(APP, { initialUrl: '/saved' })
}

const inRow = (targetId: string) => within(screen.getByTestId(`saved-${targetId}`))
const pressIn = async (targetId: string, label: string) =>
  act(async () => fireEvent.press(inRow(targetId).getByRole('button', { name: label })))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getBookmarks.mockImplementation(async (token) =>
    token === 'token-worker'
      ? [{ job_posting_id: null, job_title: 'All Saved', bookmarks: [savedJob('j1', 'React Developer', 'Wix'), savedJob('j2', 'Backend Engineer', 'Monday')] }]
      : [
          { job_posting_id: 'p1', job_title: 'Frontend Engineer', bookmarks: [savedCandidate('w1', 'Dana Levi', 'p1')] },
          { job_posting_id: null, job_title: 'Unsorted', bookmarks: [savedCandidate('w2', 'Omer Cohen', null)] },
        ])
  mocked.removeBookmark.mockResolvedValue(undefined)
  mocked.postSwipe.mockResolvedValue({ matched: false, match_id: null })
  mocked.getMyMembership.mockResolvedValue({ has_org: false } as never)
})

describe('workers', () => {
  it('see the jobs they saved', async () => {
    await open('worker')
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
    expect(inRow('j1').getByText('Wix · Tel Aviv')).toBeOnTheScreen()
    expect(screen.getByText('Backend Engineer')).toBeOnTheScreen()
    expect(screen.getByText('2 saved profiles')).toBeOnTheScreen()
  })

  it('remove takes it off the list', async () => {
    await open('worker')
    await screen.findByText('React Developer')
    await pressIn('j1', 'Remove')
    expect(mocked.removeBookmark).toHaveBeenCalledWith('token-worker', 'j1')
    await waitFor(() => expect(screen.queryByText('React Developer')).toBeNull())
    expect(screen.getByText('Backend Engineer')).toBeOnTheScreen()
  })

  it('like swipes right on it and takes it off the list', async () => {
    await open('worker')
    await screen.findByText('React Developer')
    await pressIn('j1', 'Like')
    expect(mocked.postSwipe).toHaveBeenCalledWith('token-worker', { target_id: 'j1', direction: 'like' })
    expect(mocked.removeBookmark).toHaveBeenCalledWith('token-worker', 'j1')
    await waitFor(() => expect(screen.queryByText('React Developer')).toBeNull())
  })

  it('pass swipes left on it', async () => {
    await open('worker')
    await screen.findByText('React Developer')
    await pressIn('j2', 'Pass')
    expect(mocked.postSwipe).toHaveBeenCalledWith('token-worker', { target_id: 'j2', direction: 'pass' })
  })

  it('a like that becomes a match says so', async () => {
    mocked.postSwipe.mockResolvedValueOnce({ matched: true, match_id: 'm1' })
    await open('worker')
    await screen.findByText('React Developer')
    await pressIn('j1', 'Like')
    expect(await screen.findByText("It's a Match!")).toBeOnTheScreen()
  })
})

describe('employers', () => {
  it('see saved candidates under the job they were filed for', async () => {
    await open('employer')
    expect(await screen.findByText('Dana Levi')).toBeOnTheScreen()
    expect(screen.getByText('Frontend Engineer')).toBeOnTheScreen()
    expect(screen.getByText('Unsorted')).toBeOnTheScreen()
    expect(screen.getByText('Omer Cohen')).toBeOnTheScreen()
  })

  it("team viewers can't like", async () => {
    mocked.getMyMembership.mockResolvedValue({ has_org: true, role: 'viewer' } as never)
    await open('employer')
    await screen.findByText('Dana Levi')
    await waitFor(() => expect(inRow('w1').queryByRole('button', { name: 'Like' })).toBeNull())
    expect(inRow('w1').getByRole('button', { name: 'Pass' })).toBeOnTheScreen()
  })
})

describe('states', () => {
  it('says how to save when there is nothing yet', async () => {
    mocked.getBookmarks.mockResolvedValueOnce([])
    await open('worker')
    expect(await screen.findByText('No saved profiles yet')).toBeOnTheScreen()
  })

  it('shows the error and retries', async () => {
    mocked.getBookmarks.mockRejectedValueOnce(new Error('Network request failed'))
    await open('worker')
    expect(await screen.findByText("Couldn't load this. Check your connection.")).toBeOnTheScreen()
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Retry' })))
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
  })
})
