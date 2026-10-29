// The Supabase session is stored encrypted: an AES key in the phone's secure
// store (Android Keystore / iOS Keychain), the encrypted session in
// AsyncStorage (SecureStore alone is too small for a session).
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { secureSessionStorage } from '../src/lib/secureStorage'

const session = JSON.stringify({ access_token: 'eyJ-secret-token', refresh_token: 'r-secret' })

beforeEach(async () => {
  await AsyncStorage.clear()
  ;(SecureStore as unknown as { __store: Map<string, string> }).__store.clear()
})

it('reads back exactly what was stored', async () => {
  await secureSessionStorage.setItem('sb-session', session)
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBe(session)
})

it('never writes the session in plain text', async () => {
  await secureSessionStorage.setItem('sb-session', session)
  const raw = await AsyncStorage.getItem('sb-session')
  expect(raw).toBeTruthy()
  expect(raw).not.toContain('secret')
})

it('keeps the key in the secure store, not in AsyncStorage', async () => {
  await secureSessionStorage.setItem('sb-session', session)
  expect(SecureStore.setItemAsync).toHaveBeenCalled()
  const allAsync = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())
  const key = (SecureStore as unknown as { __store: Map<string, string> }).__store.values().next().value
  expect(allAsync.some(([, v]) => v?.includes(key!))).toBe(false)
})

it('returns null for a missing item', async () => {
  await expect(secureSessionStorage.getItem('nothing')).resolves.toBeNull()
})

it('removes both the data and its key', async () => {
  await secureSessionStorage.setItem('sb-session', session)
  await secureSessionStorage.removeItem('sb-session')
  await expect(secureSessionStorage.getItem('sb-session')).resolves.toBeNull()
  expect((SecureStore as unknown as { __store: Map<string, string> }).__store.size).toBe(0)
})
