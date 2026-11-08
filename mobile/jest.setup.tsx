// Jest setup for the mobile app.
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock'

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage)

// In-memory secure store (the native Keystore/Keychain isn't there in tests).
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  }
})

// Fonts load instantly in tests.
jest.mock('./src/lib/fonts', () => ({ useAppFonts: () => true }))

// Icon fonts are native assets; tests only need the icons to render something.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  const Icon = ({ name }: { name: string }) => <Text>{name}</Text>
  return { Ionicons: Object.assign(Icon, { glyphMap: {} }) }
})

// Native gesture and animation libraries: their official test setups.
import 'react-native-gesture-handler/jestSetup'
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))
