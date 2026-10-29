// P2: the app frame. Login and sign-up against the same Supabase accounts as
// the web, routing by session, tabs by role, sign-out, expired sessions.
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))

const APP = './src/app'

beforeEach(() => {
  fakeSupabase.__reset()
})

async function signInAs(role: 'worker' | 'employer') {
  fakeSupabase.auth.signInWithPassword.mockImplementation(async () => {
    fakeSupabase.__signIn(sessionFor(role))
    return { data: {}, error: null }
  })
  await fireEvent.changeText(screen.getByLabelText('Email address'), `${role}@test.com`)
  await fireEvent.changeText(screen.getByLabelText('Password'), 'secret123')
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign in' })))
}

describe('logged out', () => {
  it('opens on the login screen', async () => {
    await renderRouter(APP, { initialUrl: '/' })
    expect(await screen.findByText('Welcome back')).toBeOnTheScreen()
  })

  it('can go to sign-up and back', async () => {
    await renderRouter(APP, { initialUrl: '/' })
    await act(async () => fireEvent.press(await screen.findByText('Create one free')))
    expect(await screen.findByText('Create your account')).toBeOnTheScreen()
    await act(async () => fireEvent.press(screen.getByText('Sign in instead')))
    expect(await screen.findByText('Welcome back')).toBeOnTheScreen()
  })

  it('cannot open a logged-in screen', async () => {
    await renderRouter(APP, { initialUrl: '/profile' })
    expect(await screen.findByText('Welcome back')).toBeOnTheScreen()
  })
})

describe('login', () => {
  it('signs in with email and password and lands on the feed', async () => {
    const router = await renderRouter(APP, { initialUrl: '/' })
    await screen.findByText('Welcome back')
    await signInAs('worker')
    expect(fakeSupabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'worker@test.com', password: 'secret123' })
    expect(await screen.findByTestId('screen-feed')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/feed')
  })

  it('shows the error when sign-in fails, and stays on login', async () => {
    fakeSupabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } })
    await renderRouter(APP, { initialUrl: '/' })
    await fireEvent.changeText(await screen.findByLabelText('Email address'), 'a@b.com')
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong')
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign in' })))
    expect(await screen.findByText('Invalid login credentials')).toBeOnTheScreen()
    expect(screen.getByText('Welcome back')).toBeOnTheScreen()
  })

  it('does not submit an empty form', async () => {
    await renderRouter(APP, { initialUrl: '/' })
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Sign in' })))
    expect(fakeSupabase.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('sign-up', () => {
  it('creates the account with the chosen role and goes to onboarding', async () => {
    fakeSupabase.auth.signUp.mockImplementation(async () => {
      fakeSupabase.__signIn(sessionFor('employer', 'new@startup.com'))
      return { data: {}, error: null }
    })
    const router = await renderRouter(APP, { initialUrl: '/register' })
    await act(async () => fireEvent.press(await screen.findByRole('radio', { name: 'Employer' })))
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'new@startup.com')
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret123')
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Create account' })))

    expect(fakeSupabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@startup.com',
      password: 'secret123',
      options: { data: { role: 'employer' } },
    })
    expect(await screen.findByTestId('screen-onboarding')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/onboarding')
  })

  it('defaults to worker', async () => {
    await renderRouter(APP, { initialUrl: '/register' })
    expect(await screen.findByRole('radio', { name: 'Worker' })).toBeChecked()
  })
})

describe('logged in', () => {
  it('a saved session opens straight to the feed', async () => {
    fakeSupabase.__reset(sessionFor('worker'))
    const router = await renderRouter(APP, { initialUrl: '/' })
    expect(await screen.findByTestId('screen-feed')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/feed')
  })

  it('workers get Feed, Saved, Matches and Profile tabs', async () => {
    fakeSupabase.__reset(sessionFor('worker'))
    await renderRouter(APP, { initialUrl: '/' })
    await screen.findByTestId('screen-feed')
    // The tab bar labels each tab for screen readers: "Feed, tab, 1 of 4".
    ;['Feed', 'Saved', 'Matches', 'Profile'].forEach((tab, i) => {
      expect(screen.getByLabelText(`${tab}, tab, ${i + 1} of 4`)).toBeOnTheScreen()
    })
    expect(screen.queryByLabelText(/^Jobs, tab/)).toBeNull()
    expect(screen.queryByLabelText(/^Team, tab/)).toBeNull()
  })

  it('employers also get Jobs and Team tabs', async () => {
    fakeSupabase.__reset(sessionFor('employer'))
    await renderRouter(APP, { initialUrl: '/' })
    await screen.findByTestId('screen-feed')
    ;['Feed', 'Jobs', 'Team', 'Saved', 'Matches', 'Profile'].forEach((tab, i) => {
      expect(screen.getByLabelText(`${tab}, tab, ${i + 1} of 6`)).toBeOnTheScreen()
    })
  })

  it('profile shows the account and signs out back to login', async () => {
    fakeSupabase.__reset(sessionFor('worker', 'dana@test.com'))
    await renderRouter(APP, { initialUrl: '/profile' })
    expect(await screen.findByText('dana@test.com')).toBeOnTheScreen()
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign out' })))
    expect(fakeSupabase.auth.signOut).toHaveBeenCalled()
    expect(await screen.findByText('Welcome back')).toBeOnTheScreen()
  })

  it('an expired session (API 401) signs out', async () => {
    fakeSupabase.__reset(sessionFor('worker'))
    await renderRouter(APP, { initialUrl: '/' })
    await screen.findByTestId('screen-feed')
    const { getMatches } = require('@jobswipe/shared/api')
    globalThis.fetch = jest.fn(async () => new Response(JSON.stringify({ detail: 'Token expired' }), { status: 401 }))
    await act(async () => {
      await expect(getMatches('token-worker')).rejects.toThrow('Token expired')
    })
    expect(fakeSupabase.auth.signOut).toHaveBeenCalled()
    expect(await screen.findByText('Welcome back')).toBeOnTheScreen()
  })
})
