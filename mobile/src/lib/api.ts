// The shared API client (packages/shared), configured for the app.
import { configureApi } from '@jobswipe/shared/api'
import { config } from './config'

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

/** AuthProvider subscribes: a 401 on an authenticated call means the session expired. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

configureApi({
  baseUrl: config.apiUrl,
  onUnauthorized: () => unauthorizedListeners.forEach((l) => l()),
})

export * from '@jobswipe/shared/api'
