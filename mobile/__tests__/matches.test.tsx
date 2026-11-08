// P5: matches list and chat. Same behaviour as the web Matches.tsx/Chat.tsx:
// each match shows the other side and unread count, opens a chat, messages
// send and arrive (polling), and a refused message keeps the draft.
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
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
}))

// The 3-second timer itself is tested in usePolling.test; here the test runs the poll.
jest.mock('../src/lib/usePolling', () => ({ usePolling: jest.fn() }))

const mocked = api as jest.Mocked<typeof api>
const mockedPolling = usePolling as jest.Mock
const APP = './src/app'

const match = (id: string, company: string, worker: string): api.Match => ({
  id, worker_id: 'id-worker', employer_id: 'id-employer', job_posting_id: 'j1',
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
