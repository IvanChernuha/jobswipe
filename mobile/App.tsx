import { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

// Harbor palette (frontend/tailwind.config.js); moves to packages/shared in P1.
const colors = {
  ground: '#F5F1EA',
  ink: '#14213D',
  muted: '#5B6373',
  brand: '#0E7C7B',
  danger: '#B42318',
}

type Status =
  | { kind: 'checking' }
  | { kind: 'connected'; categories: number }
  | { kind: 'unreachable' }
  | { kind: 'unconfigured' }

/** Asks the real backend for its skill categories: proves the phone can reach it. */
function useServerStatus(): Status {
  const [status, setStatus] = useState<Status>({ kind: 'checking' })

  useEffect(() => {
    // Inlined at build time from the environment (see app.config / build script).
    const api = process.env.EXPO_PUBLIC_API_URL
    if (!api) {
      setStatus({ kind: 'unconfigured' })
      return
    }
    let cancelled = false
    fetch(`${api}/tags/categories`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const categories = (await res.json()) as unknown[]
        if (!cancelled) setStatus({ kind: 'connected', categories: categories.length })
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: 'unreachable' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}

export default function App() {
  const status = useServerStatus()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JobSwipe</Text>
      <Text style={styles.tagline}>Swipe your way into a startup</Text>

      <View style={styles.status}>
        {status.kind === 'checking' && <Text style={styles.muted}>Connecting to the server…</Text>}
        {status.kind === 'connected' && (
          <>
            <Text style={styles.ok}>Connected to the JobSwipe server ✓</Text>
            <Text style={styles.muted}>{status.categories} skill categories loaded</Text>
          </>
        )}
        {status.kind === 'unreachable' && <Text style={styles.error}>Can't reach the server</Text>}
        {status.kind === 'unconfigured' && <Text style={styles.error}>No server address configured</Text>}
      </View>

      <StatusBar style="dark" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: { fontSize: 44, fontWeight: '700', color: colors.ink, letterSpacing: -0.5 },
  tagline: { marginTop: 8, fontSize: 17, color: colors.brand, fontWeight: '600' },
  status: { marginTop: 48, alignItems: 'center', gap: 6 },
  ok: { fontSize: 16, color: colors.brand, fontWeight: '600' },
  muted: { fontSize: 14, color: colors.muted },
  error: { fontSize: 16, color: colors.danger, fontWeight: '600' },
})
