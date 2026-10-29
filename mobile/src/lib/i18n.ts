// Same texts as the web (packages/shared). The phone's language on first
// run, the user's choice afterwards. Hebrew is right-to-left: React Native
// applies a direction change on the next app start.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { I18nManager } from 'react-native'
import * as Localization from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@jobswipe/shared/i18n/locales/en.json'
import he from '@jobswipe/shared/i18n/locales/he.json'

export const LANGUAGES = [
  { code: 'en', label: 'English', rtl: false },
  { code: 'he', label: 'עברית', rtl: true },
] as const
export type LangCode = (typeof LANGUAGES)[number]['code']

const STORAGE_KEY = 'lang'
const isSupported = (code: string | null | undefined): code is LangCode => LANGUAGES.some((l) => l.code === code)

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, he: { translation: he } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

/** The saved choice, else the phone's language if we have it, else English. */
export async function initialLanguage(): Promise<LangCode> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY)
  if (isSupported(saved)) return saved
  const device = Localization.getLocales()[0]?.languageCode
  return isSupported(device) ? device : 'en'
}

/** Switch language and layout direction. needsRestart: the direction only flips after a restart. */
export async function setLanguage(code: LangCode): Promise<{ needsRestart: boolean }> {
  await AsyncStorage.setItem(STORAGE_KEY, code)
  await i18n.changeLanguage(code)
  const rtl = LANGUAGES.find((l) => l.code === code)!.rtl
  I18nManager.allowRTL(rtl)
  I18nManager.forceRTL(rtl)
  return { needsRestart: rtl !== I18nManager.isRTL }
}

export default i18n
