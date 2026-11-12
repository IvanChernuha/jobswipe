// P5: matches list and chat. Same behaviour as the web Matches.tsx/Chat.tsx:
// each match shows the other side and unread count, opens a chat, messages
// send and arrive (polling), and a refused message keeps the draft.
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { Linking } from 'react-native'
import * as api from '@jobswipe/shared/api'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'
import { usePolling } from '../src/lib/usePolling'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getMatches: jest.fn(),
  getMatch: jest.fn(),
  getUnreadCounts: jest.fn(),
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  getJobPostings: jest.fn(),
  getMatchResume: jest.fn(),
  moveMatch: jest.fn(),
  submitReport: jest.fn(),
  blockUser: jest.fn(),
}))
// A real server address, so CV links (server paths) become full URLs.
jest.mock('../src/lib/config', () => ({ config: { apiUrl: 'https://jobswipe.test/api', supabaseUrl: '', supabaseAnonKey: '' } }))

// The 3-second timer itself is tested in usePolling.test; here the test runs the poll.
jest.mock('../src/lib/usePolling', () => ({ usePolling: jest.fn() }))

const mocked = api as jest.Mocked<typeof api>
const mockedPolling = usePolling as jest.Mock
const APP = './src/app'

const match = (id: string, company: string, worker: string, jobId: string | null = 'j1'): api.Match => ({
  id, worker_id: 'id-worker', employer_id: 'id-employer', job_posting_id: jobId,
  matched_at: '2026-11-01T10:00:00Z', status: 'active',
  worker: { name: worker, avatar_url: null, skills: [], experience_years: 2 },
  employer: { company_name: company, industry: 'Software', avatar_url: null, job_title: 'React Developer', location: 'Tel Aviv' },
})

const msg = (id: string, body: string, mine: boolean, at = '2026-11-08T09:00:00Z'): api.Message => ({
  id, match_id: 'm1', sender_id: mine ? 'me' : 'them', body, created_at: at, is_mine: mine,
})

async function open(role: 'worker' | 'employer', url: string) {
  fakeSupabase.__reset(sessionFor(role))
  return renderRouter(APP, { initialUrl: url })
}

const press = async (label: string) => act(async () => fireEvent.press(screen.getByRole('button', { name: label })))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getMatches.mockResolvedValue([match('m1', 'Wix', 'Dana Levi'), match('m2', 'Monday', 'Omer Cohen')])
  mocked.getUnreadCounts.mockResolvedValue([{ match_id: 'm1', count: 3 }])
  mocked.getMatch.mockResolvedValue(match('m1', 'Wix', 'Dana Levi'))
  mocked.getMessages.mockResolvedValue([msg('a', 'Hi! Loved your profile', false), msg('b', 'Thanks, happy to talk', true)])
  mocked.sendMessage.mockImplementation(async (_t, _m, body) => msg('new', body, true))
  mocked.getJobPostings.mockResolvedValue([
    { id: 'j1', title: 'Frontend Engineer' }, { id: 'j2', title: 'Backend Engineer' },
  ] as api.JobPosting[])
})

describe('matches list', () => {
  it('workers see the companies they matched with, with the job', async () => {
    await open('worker', '/matches')
    expect(await screen.findByText('Wix')).toBeOnTheScreen()
    expect(screen.getByText('Monday')).toBeOnTheScreen()
    expect(screen.getAllByText('React Developer')).toHaveLength(2)
    expect(mocked.getMatches).toHaveBeenCalledWith('token-worker')
  })

  it('employers see the candidates', async () => {
    await open('employer', '/matches')
    expect(await screen.findByText('Dana Levi')).toBeOnTheScreen()
    expect(screen.getByText('Omer Cohen')).toBeOnTheScreen()
  })

  it('employers see their matches grouped under the job they matched for', async () => {
    mocked.getMatches.mockResolvedValueOnce([
      match('m1', 'Wix', 'Dana Levi', 'j1'), match('m2', 'Wix', 'Omer Cohen', 'j2'),
      match('m3', 'Wix', 'Noa Katz', 'j1'), match('m4', 'Wix', 'Yossi Bar', null),
    ])
    await open('employer', '/matches')
    await screen.findByText('Dana Levi')
    const frontend = within(screen.getByTestId('matches-job-j1'))
    expect(frontend.getByText('Frontend Engineer')).toBeOnTheScreen()
    expect(frontend.getByText('Dana Levi')).toBeOnTheScreen()
    expect(frontend.getByText('Noa Katz')).toBeOnTheScreen()
    expect(frontend.getByText('2 matches')).toBeOnTheScreen()
    expect(within(screen.getByTestId('matches-job-j2')).getByText('Omer Cohen')).toBeOnTheScreen()
    expect(within(screen.getByTestId('matches-job-none')).getByText('Yossi Bar')).toBeOnTheScreen()
  })

  it('workers see one list (each row already says the job)', async () => {
    await open('worker', '/matches')
    await screen.findByText('Wix')
    expect(screen.queryByTestId('matches-job-j1')).toBeNull()
    expect(mocked.getJobPostings).not.toHaveBeenCalled()
  })

  it('shows how many messages are unread', async () => {
    await open('worker', '/matches')
    await screen.findByText('Wix')
    expect(screen.getByLabelText('3 unread')).toBeOnTheScreen()
  })

  it('says when there are no matches yet', async () => {
    mocked.getMatches.mockResolvedValueOnce([])
    await open('worker', '/matches')
    expect(await screen.findByText('No matches yet')).toBeOnTheScreen()
  })

  it('shows the error and retries', async () => {
    mocked.getMatches.mockRejectedValueOnce(new Error('Network request failed'))
    await open('worker', '/matches')
    expect(await screen.findByText('Failed to load matches')).toBeOnTheScreen()
    await press('Retry')
    expect(await screen.findByText('Wix')).toBeOnTheScreen()
  })

  it('tapping a match opens its chat', async () => {
    const router = await open('worker', '/matches')
    await screen.findByText('Wix')
    await act(async () => fireEvent.press(screen.getByText('Wix')))
    await waitFor(() => expect(router.getPathname()).toBe('/chat/m1'))
  })
})

describe('chat', () => {
  it('shows who you are talking to and the conversation', async () => {
    await open('worker', '/chat/m1')
    expect(await screen.findByText('Hi! Loved your profile')).toBeOnTheScreen()
    expect(screen.getByText('Thanks, happy to talk')).toBeOnTheScreen()
    expect(screen.getByText('Wix')).toBeOnTheScreen()
    expect(mocked.getMessages).toHaveBeenCalledWith('token-worker', 'm1')
  })

  it('invites you to say hello when empty', async () => {
    mocked.getMessages.mockResolvedValue([])
    await open('employer', '/chat/m1')
    expect(await screen.findByText('Say hello to Dana Levi!')).toBeOnTheScreen()
  })

  it('sends a message and clears the box', async () => {
    await open('worker', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    await act(async () => fireEvent.changeText(screen.getByLabelText('Type a message...'), '  When can we meet?  '))
    await press('Send')
    expect(mocked.sendMessage).toHaveBeenCalledWith('token-worker', 'm1', 'When can we meet?')
    expect(await screen.findByText('When can we meet?')).toBeOnTheScreen()
    expect(screen.getByLabelText('Type a message...')).toHaveDisplayValue('')
  })

  it('does not send an empty message', async () => {
    await open('worker', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    await act(async () => fireEvent.changeText(screen.getByLabelText('Type a message...'), '   '))
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('a refused message says why and keeps the draft', async () => {
    mocked.sendMessage.mockRejectedValueOnce(new Error('Message contains blocked content'))
    await open('worker', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    await act(async () => fireEvent.changeText(screen.getByLabelText('Type a message...'), 'call me 050...'))
    await press('Send')
    expect(await screen.findByText('Not sent: Message contains blocked content')).toBeOnTheScreen()
    expect(screen.getByLabelText('Type a message...')).toHaveDisplayValue('call me 050...')
  })

  it('new messages from the other side arrive on their own', async () => {
    await open('worker', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    const [poll, ms] = mockedPolling.mock.calls[mockedPolling.mock.calls.length - 1]
    expect(ms).toBe(3000)
    mocked.getMessages.mockResolvedValue([
      msg('a', 'Hi! Loved your profile', false), msg('b', 'Thanks, happy to talk', true), msg('c', 'Tuesday at 10?', false),
    ])
    await act(async () => poll())
    expect(await screen.findByText('Tuesday at 10?')).toBeOnTheScreen()
  })

  it('back returns to the matches', async () => {
    const router = await open('worker', '/matches')
    await screen.findByText('Wix')
    await act(async () => fireEvent.press(screen.getByText('Wix')))
    await screen.findByText('Hi! Loved your profile')
    await press('Back')
    await waitFor(() => expect(router.getPathname()).toBe('/matches'))
  })
})

describe('full profile', () => {
  const fullMatch = (): api.Match => ({
    ...match('m1', 'Wix', 'Dana Levi'),
    worker: {
      name: 'Dana Levi', avatar_url: null, skills: [], experience_years: 2, bio: 'Bootcamp grad who loves React',
      location: 'Haifa', tags: [{ id: 't1', name: 'React', category: 'framework' }], has_resume: true,
    },
    employer: {
      company_name: 'Wix', industry: 'Software', avatar_url: null, job_title: 'React Developer', location: 'Tel Aviv',
      company_description: 'We build websites', description: 'Build our editor', salary_min: 15000, salary_max: 22000,
      remote: false, tags: [{ id: 't1', name: 'React', category: 'framework', requirement: 'required' }],
    },
  })

  beforeEach(() => {
    mocked.getMatch.mockResolvedValue(fullMatch())
    mocked.getMatchResume.mockResolvedValue('/supabase/storage/v1/object/sign/resumes/w1/resume.pdf?token=t')
  })

  it('opens from the chat header', async () => {
    const router = await open('employer', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    await press('View profile')
    await waitFor(() => expect(router.getPathname()).toBe('/match/m1'))
  })

  it('opens from the matches list', async () => {
    const router = await open('employer', '/matches')
    await screen.findByText('Dana Levi')
    await press('View profile: Dana Levi')
    await waitFor(() => expect(router.getPathname()).toBe('/match/m1'))
  })

  it("employers read the candidate's whole profile and open the CV", async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    await open('employer', '/match/m1')
    expect(await screen.findByText('Bootcamp grad who loves React')).toBeOnTheScreen()
    expect(screen.getByText('Haifa')).toBeOnTheScreen()
    expect(screen.getByText('React')).toBeOnTheScreen()
    await press('Open CV')
    expect(mocked.getMatchResume).toHaveBeenCalledWith('token-employer', 'm1')
    expect(openURL).toHaveBeenCalledWith('https://jobswipe.test/supabase/storage/v1/object/sign/resumes/w1/resume.pdf?token=t')
    openURL.mockRestore()
  })

  it('says when there is no CV', async () => {
    const m = fullMatch()
    mocked.getMatch.mockResolvedValue({ ...m, worker: { ...m.worker!, has_resume: false } })
    await open('employer', '/match/m1')
    expect(await screen.findByText('No CV uploaded yet')).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Open CV' })).toBeNull()
  })

  it('says so when the CV will not open', async () => {
    mocked.getMatchResume.mockRejectedValueOnce(new Error('Network request failed'))
    await open('employer', '/match/m1')
    await screen.findByText('Bootcamp grad who loves React')
    await press('Open CV')
    expect(await screen.findByText("Couldn't open the CV. Try again.")).toBeOnTheScreen()
  })

  it('workers read the whole job and the company', async () => {
    await open('worker', '/match/m1')
    expect(await screen.findByText('Build our editor')).toBeOnTheScreen()
    expect(screen.getByText('We build websites')).toBeOnTheScreen()
    expect(screen.getByText('₪15k–₪22k')).toBeOnTheScreen()
    expect(screen.getByText('React')).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Open CV' })).toBeNull()
  })
})

describe('moving a match to another job', () => {
  beforeEach(() => {
    mocked.getMatch.mockResolvedValue(match('m1', 'Wix', 'Dana Levi', 'j1'))
    mocked.moveMatch.mockImplementation(async (_t, id, jobId) => match(id, 'Wix', 'Dana Levi', jobId))
  })

  it('employers pick another of their jobs and the match moves', async () => {
    await open('employer', '/match/m1')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Move to another job' })))
    expect(screen.getByRole('radio', { name: 'Frontend Engineer' })).toBeChecked()
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Backend Engineer' })))
    expect(mocked.moveMatch).toHaveBeenCalledWith('token-employer', 'm1', 'j2')
    expect(await screen.findByText('Moved to Backend Engineer')).toBeOnTheScreen()
  })

  it('picking the job it is already under does nothing', async () => {
    await open('employer', '/match/m1')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Move to another job' })))
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Frontend Engineer' })))
    expect(mocked.moveMatch).not.toHaveBeenCalled()
  })

  it('shows why when it cannot move', async () => {
    mocked.moveMatch.mockRejectedValueOnce(new Error('Your role (viewer) cannot perform: chat'))
    await open('employer', '/match/m1')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Move to another job' })))
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Backend Engineer' })))
    expect(await screen.findByText('Your role (viewer) cannot perform: chat')).toBeOnTheScreen()
  })

  it('job seekers cannot move a match', async () => {
    await open('worker', '/match/m1')
    await screen.findByText('React Developer')
    expect(screen.queryByRole('button', { name: 'Move to another job' })).toBeNull()
  })
})

describe('moving a match from the list', () => {
  it('employers move a match straight from the Matches list', async () => {
    mocked.moveMatch.mockImplementation(async (_t, id, jobId) => match(id, 'Wix', 'Dana Levi', jobId))
    await open('employer', '/matches')
    await screen.findByText('Dana Levi')
    expect(within(screen.getByTestId('matches-job-j1')).getByText('Dana Levi')).toBeOnTheScreen()
    await press('Move Dana Levi to another job')
    expect(await screen.findByRole('radio', { name: 'Frontend Engineer' })).toBeChecked()
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Backend Engineer' })))
    expect(mocked.moveMatch).toHaveBeenCalledWith('token-employer', 'm1', 'j2')
    await waitFor(() => expect(within(screen.getByTestId('matches-job-j2')).getByText('Dana Levi')).toBeOnTheScreen())
  })

  it('job seekers have nothing to move', async () => {
    await open('worker', '/matches')
    await screen.findByText('Wix')
    expect(screen.queryByRole('button', { name: /to another job/ })).toBeNull()
  })
})

describe('report and block', () => {
  beforeEach(() => {
    mocked.getMatch.mockResolvedValue(match('m1', 'Wix', 'Dana Levi', 'j1'))
    mocked.submitReport.mockResolvedValue({} as never)
    mocked.blockUser.mockResolvedValue({ blocked: true, matches_archived: 1 })
  })

  it('reports and blocks from the chat, then goes back to the matches', async () => {
    const router = await open('worker', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    await press('Report User')
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Harassment' })))
    await act(async () => fireEvent.changeText(screen.getByLabelText('Details (optional)'), 'Rude messages'))
    expect(screen.getByRole('switch', { name: 'Also block this user' })).toBeChecked()
    await press('Report & Block')
    // A worker reports the employer side of the match.
    expect(mocked.submitReport).toHaveBeenCalledWith('token-worker', 'id-employer', 'user', 'harassment', 'Rude messages')
    expect(mocked.blockUser).toHaveBeenCalledWith('token-worker', 'id-employer')
    expect(await screen.findByText('Reported & Blocked')).toBeOnTheScreen()
    await press('Done')
    await waitFor(() => expect(router.getPathname()).toBe('/matches'))
  })

  it('can report without blocking', async () => {
    await open('employer', '/match/m1')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Report User' })))
    await act(async () => fireEvent(screen.getByRole('switch', { name: 'Also block this user' }), 'valueChange', false))
    await press('Submit Report')
    expect(mocked.submitReport).toHaveBeenCalledWith('token-employer', 'id-worker', 'user', 'spam', '')
    expect(mocked.blockUser).not.toHaveBeenCalled()
    expect(await screen.findByText('Report Submitted')).toBeOnTheScreen()
  })

  it('says so when you already reported them', async () => {
    mocked.submitReport.mockRejectedValueOnce(new Error('You have already reported this'))
    await open('worker', '/chat/m1')
    await screen.findByText('Hi! Loved your profile')
    await press('Report User')
    await press('Report & Block')
    expect(await screen.findByText('You have already reported this')).toBeOnTheScreen()
    expect(mocked.blockUser).not.toHaveBeenCalled()
  })
})
