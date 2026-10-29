// Language: the phone's language on first run, the user's choice after that.
// Hebrew needs right-to-left layout, which React Native applies on the next
// app start, so switching direction asks for a restart.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { I18nManager } from 'react-native'
import * as Localization from 'expo-localization'
import { initialLanguage, setLanguage } from '../src/lib/i18n'
import i18n from '../src/lib/i18n'

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageCode: 'en' }]) }))

const device = (code: string) => (Localization.getLocales as jest.Mock).mockReturnValue([{ languageCode: code }])

beforeEach(async () => {
  await AsyncStorage.clear()
  device('en')
  jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {})
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => {})
})

it('uses the phone language on first run', async () => {
  device('he')
  await expect(initialLanguage()).resolves.toBe('he')
})

it('falls back to English for languages we do not have', async () => {
  device('fr')
  await expect(initialLanguage()).resolves.toBe('en')
})

it("remembers the user's choice over the phone language", async () => {
  device('en')
  await setLanguage('he')
  await expect(initialLanguage()).resolves.toBe('he')
})

it('switching to Hebrew translates and turns on right-to-left', async () => {
  const result = await setLanguage('he')
  expect(i18n.t('login.welcomeBack')).toBe('ברוכים השבים')
  expect(I18nManager.forceRTL).toHaveBeenCalledWith(true)
  expect(result.needsRestart).toBe(!I18nManager.isRTL)
})

it('switching back to English turns right-to-left off', async () => {
  await setLanguage('en')
  expect(i18n.t('login.welcomeBack')).toBe('Welcome back')
  expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(false)
})
