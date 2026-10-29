// Encrypted storage for the Supabase session. SecureStore (Android Keystore /
// iOS Keychain) holds only a per-item AES-256 key, because its values are too
// small for a session; the encrypted session goes in AsyncStorage.
import 'react-native-get-random-values'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as aesjs from 'aes-js'

// SecureStore keys may only contain [A-Za-z0-9._-].
const keyName = (key: string) => `k_${key.replace(/[^A-Za-z0-9._-]/g, '_')}`

async function encrypt(key: string, value: string): Promise<string> {
  const aesKey = crypto.getRandomValues(new Uint8Array(32))
  const cipher = new aesjs.ModeOfOperation.ctr(aesKey, new aesjs.Counter(1))
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value))
  await SecureStore.setItemAsync(keyName(key), aesjs.utils.hex.fromBytes(aesKey))
  return aesjs.utils.hex.fromBytes(encrypted)
}

async function decrypt(key: string, value: string): Promise<string | null> {
  const hexKey = await SecureStore.getItemAsync(keyName(key))
  if (!hexKey) return null
  const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(hexKey), new aesjs.Counter(1))
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)))
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key)
    return encrypted ? decrypt(key, encrypted) : null
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await encrypt(key, value))
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key)
    await SecureStore.deleteItemAsync(keyName(key))
  },
}
