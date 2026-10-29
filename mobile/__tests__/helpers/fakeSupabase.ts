// A controllable stand-in for the Supabase client: tests decide what sign-in
// returns and push session changes the way Supabase's listener would.
type Session = { access_token: string; user: { id: string; email: string; user_metadata: { role?: string } } }
type Listener = (event: string, session: Session | null) => void

let current: Session | null = null
const listeners = new Set<Listener>()

function emit(event: string, session: Session | null) {
  current = session
  listeners.forEach((l) => l(event, session))
}

export function sessionFor(role: 'worker' | 'employer', email = `${role}@test.com`): Session {
  return { access_token: `token-${role}`, user: { id: `id-${role}`, email, user_metadata: { role } } }
}

export const fakeSupabase = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: current }, error: null })),
    onAuthStateChange: jest.fn((cb: Listener) => {
      listeners.add(cb)
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    }),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(async () => {
      emit('SIGNED_OUT', null)
      return { error: null }
    }),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  /** Test helpers (not part of Supabase). */
  __reset(session: Session | null = null) {
    current = session
    listeners.clear()
    Object.values(fakeSupabase.auth).forEach((fn) => (fn as jest.Mock).mockClear?.())
  },
  __signIn(session: Session) {
    emit('SIGNED_IN', session)
  },
}
