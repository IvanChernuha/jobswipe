import { useAuthContext } from '../context/AuthContext'

/**
 * Convenience hook — returns the full AuthContext value.
 * Use this everywhere instead of importing useAuthContext directly.
 */
export function useAuth() {
  return useAuthContext()
}
