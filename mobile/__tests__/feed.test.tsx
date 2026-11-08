// P4: the swipe feed. Same behaviour as the web feed: real cards from the
// API, like/pass/super like/bookmark, one-step undo, the match popup,
// empty/error states, and team viewers can't like.
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getWorkerFeed: jest.fn(),
  getEmployerFeed: jest.fn(),
  postSwipe: jest.fn(),
  undoLastSwipe: jest.fn(),
  addBookmark: jest.fn(),
  removeBookmark: jest.fn(),
  getMyMembership: jest.fn(),
}))

// The animated deck (Reanimated + gestures) is visual; its swipe decision is
// unit-tested in packages/shared (swipeDecision). Here it just shows the top card.
jest.mock('../src/components/SwipeDeck', () => {
  const SwipeCard = require('../src/components/SwipeCard').default
  return ({ top }: { top: unknown }) => (top ? <SwipeCard card={top} /> : null)
})

const mocked = api as jest.Mocked<typeof api>
const APP = './src/app'

const job = (id: string, title: string, company: string, pct = 86) => ({
  id, job_title: title, company_name: company, avatar_url: null, description: `We build ${title}`,
  location: 'Tel Aviv', industry: 'Software', salary_min: 15000, salary_max: 22000, skills_required: [],
  tags: [{ id: 't1', name: 'React', category: 'framework' }, { id: 't2', name: 'TypeScript', category: 'language' }],
  match_score: { matched: 6, total: 7, percentage: pct },
})

const candidate = (id: string, name: string) => ({
  id, name, avatar_url: null, bio: 'Bootcamp grad who loves React', location: 'Haifa', skills: [],
  experience_years: 1, tags: [{ id: 't1', name: 'React', category: 'framework' }],
  match_score: { matched: 3, total: 4, percentage: 75, job_id: 'j1', job_title: 'Frontend Engineer' },
})

async function openFeedAs(role: 'worker' | 'employer') {
  fakeSupabase.__reset(sessionFor(role))
  await renderRouter(APP, { initialUrl: '/feed' })
}

const press = async (label: string) => act(async () => fireEvent.press(screen.getByRole('button', { name: label })))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getWorkerFeed.mockResolvedValue([job('j1', 'React Developer', 'Wix'), job('j2', 'Backend Engineer', 'Monday')] as never)
  mocked.getEmployerFeed.mockResolvedValue([candidate('w1', 'Dana Levi'), candidate('w2', 'Omer Cohen')] as never)
  mocked.postSwipe.mockResolvedValue({ matched: false, match_id: null })
  mocked.undoLastSwipe.mockResolvedValue({ undone: true, target_id: 'j1' })
  mocked.addBookmark.mockResolvedValue({} as never)
  mocked.removeBookmark.mockResolvedValue(undefined)
  mocked.getMyMembership.mockResolvedValue({ has_org: false } as never)
})

describe('loading the feed', () => {
  it('workers see real jobs, top card first', async () => {
    await openFeedAs('worker')
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
    expect(screen.getByText('Wix · Software')).toBeOnTheScreen()
    expect(screen.getByText('86%')).toBeOnTheScreen()
    expect(screen.getByText('React')).toBeOnTheScreen()
    expect(mocked.getWorkerFeed).toHaveBeenCalledWith('token-worker')
  })

  it('employers see real candidates with the job they fit best', async () => {
    await openFeedAs('employer')
    expect(await screen.findByText('Dana Levi')).toBeOnTheScreen()
    expect(screen.getByText('75%')).toBeOnTheScreen()
    expect(screen.getByText('for Frontend Engineer')).toBeOnTheScreen()
    expect(mocked.getEmployerFeed).toHaveBeenCalledWith('token-employer')
  })

  it('shows the error and retries', async () => {
    mocked.getWorkerFeed.mockRejectedValueOnce(new Error('Network request failed'))
    await openFeedAs('worker')
    expect(await screen.findByText('Failed to load feed')).toBeOnTheScreen()
    await press('Retry')
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
  })

  it('says when there is nothing left, and can refresh', async () => {
    mocked.getWorkerFeed.mockResolvedValueOnce([])
    await openFeedAs('worker')
    expect(await screen.findByText("You're all caught up!")).toBeOnTheScreen()
    await press('Refresh')
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
  })
})

describe('swiping', () => {
  it('like sends a like and shows the next card', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await press('Like')
    expect(mocked.postSwipe).toHaveBeenCalledWith('token-worker', { target_id: 'j1', direction: 'like' })
    expect(await screen.findByText('Backend Engineer')).toBeOnTheScreen()
  })

  it('pass sends a pass', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await press('Pass')
    expect(mocked.postSwipe).toHaveBeenCalledWith('token-worker', { target_id: 'j1', direction: 'pass' })
  })

  it('super like sends a super like', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await press('Super Like')
    expect(mocked.postSwipe).toHaveBeenCalledWith('token-worker', { target_id: 'j1', direction: 'super_like' })
  })

  it('tapping like twice quickly sends only one swipe', async () => {
    let finish: (v: api.SwipeResponse) => void = () => {}
    mocked.postSwipe.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Like' }))
      fireEvent.press(screen.getByRole('button', { name: 'Like' }))
    })
    await act(async () => finish({ matched: false, match_id: null }))
    expect(mocked.postSwipe).toHaveBeenCalledTimes(1)
  })

  it('bookmark saves for later and moves on without a swipe', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await press('Bookmark')
    expect(mocked.addBookmark).toHaveBeenCalledWith('token-worker', 'j1')
    expect(mocked.postSwipe).not.toHaveBeenCalled()
    expect(await screen.findByText('Backend Engineer')).toBeOnTheScreen()
  })
})

describe('undo', () => {
  it('is not offered before the first swipe', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('takes back the last swipe and shows that card again', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await press('Pass')
    await screen.findByText('Backend Engineer')
    await press('Undo')
    expect(mocked.undoLastSwipe).toHaveBeenCalledWith('token-worker')
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
  })

  it('after a bookmark, removes the bookmark instead', async () => {
    await openFeedAs('worker')
    await screen.findByText('React Developer')
    await press('Bookmark')
    await screen.findByText('Backend Engineer')
    await press('Undo')
    expect(mocked.removeBookmark).toHaveBeenCalledWith('token-worker', 'j1')
    expect(mocked.undoLastSwipe).not.toHaveBeenCalled()
    expect(await screen.findByText('React Developer')).toBeOnTheScreen()
  })
})

describe("it's a match", () => {
  beforeEach(() => {
    mocked.postSwipe.mockResolvedValue({ matched: true, match_id: 'm1' })
  })

  it('celebrates a match and can keep swiping', async () => {
    await openFeedAs('employer')
    await screen.findByText('Dana Levi')
    await press('Like')
    expect(await screen.findByText("It's a Match!")).toBeOnTheScreen()
    expect(screen.getByText('You and Dana Levi both swiped right.')).toBeOnTheScreen()
    await press('Keep Swiping')
    await waitFor(() => expect(screen.queryByText("It's a Match!")).toBeNull())
    expect(screen.getByText('Omer Cohen')).toBeOnTheScreen()
  })

  it('start chat goes to the matches', async () => {
    const router = await (async () => {
      fakeSupabase.__reset(sessionFor('employer'))
      return renderRouter(APP, { initialUrl: '/feed' })
    })()
    await screen.findByText('Dana Levi')
    await press('Like')
    await press('Start Chat')
    await waitFor(() => expect(router.getPathname()).toBe('/matches'))
  })
})

describe('team viewers', () => {
  it("can't like or super like, only pass and bookmark", async () => {
    mocked.getMyMembership.mockResolvedValue({ has_org: true, role: 'viewer' } as never)
    await openFeedAs('employer')
    await screen.findByText('Dana Levi')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Like' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Super Like' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pass' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBeOnTheScreen()
  })
})
