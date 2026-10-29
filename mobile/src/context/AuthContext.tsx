import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Role } from '@jobswipe/shared/api'
import { supabase } from '../lib/supabase'
import { onUnauthorized } from '../lib/api'

interface AuthValue {
  session: Session | null
  role: Role | null
  loading: boolean
  /** True right after sign-up, until onboarding is left. */
  isNewAccount: boolean
  markNewAccount: () => void
  finishOnboarding: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Same rule as the web (frontend/src/context/AuthContext.tsx). */
function roleOf(session: Session | null): Role | null {
  const u = session?.user
  const r = (u?.user_metadata?.role ?? u?.app_metadata?.role) as string | undefined
  return r === 'worker' || r === 'employer' ? r : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isNewAccount, setNewAccount] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setNewAccount(false)
  }, [])

  // A 401 on an authenticated API call: the session expired, so sign out.
  useEffect(() => onUnauthorized(() => void signOut()), [signOut])

  return (
    <AuthContext.Provider
      value={{
        session,
        role: roleOf(session),
        loading,
        isNewAccount,
        markNewAccount: () => setNewAccount(true),
        finishOnboarding: () => setNewAccount(false),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
