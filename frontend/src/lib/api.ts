// The API client lives in packages/shared (used by the web and the mobile app).
// This file configures it for the web and re-exports it, so pages keep
// importing from '../lib/api'.
import { configureApi } from '@jobswipe/shared/api'

configureApi({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '/api',
  // Expired/invalid session: AuthContext listens for this, signs out and redirects.
  onUnauthorized: () => window.dispatchEvent(new CustomEvent('jobswipe:unauthorized')),
})

export * from '@jobswipe/shared/api'
