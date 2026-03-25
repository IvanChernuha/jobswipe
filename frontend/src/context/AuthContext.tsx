import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Role } from '../lib/api'

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: Role | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

// Derive role from user metadata — module-level so it is stable (no closure issues)
function extractRole(u: User | null): Role | null {
  if (!u) return null
  const r = u.user_metadata?.role as string | undefined
  if (r === 'worker' || r === 'employer') return r
  // Fall back to app_metadata (set by backend)
  const ar = u.app_metadata?.role as string | undefined
  if (ar === 'worker' || ar === 'employer') return ar
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(true)

  const applySession = useCallback((s: Session | null) => {
    setSession(s)
    setUser(s?.user ?? null)
    setRole(extractRole(s?.user ?? null))
  }, [])

  useEffect(() => {
    // Fetch existing session
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session)
      setLoading(false)
    })

    // Listen for auth state changes (login, logout, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s)
      setLoading(false)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [applySession])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
    setRole(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Internal hook — used by useAuth
// ---------------------------------------------------------------------------

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>')
  return ctx
}
