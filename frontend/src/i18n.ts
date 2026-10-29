import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
// Translations are shared with the mobile app (packages/shared/src/i18n/locales).
import en from '@jobswipe/shared/i18n/locales/en.json'
import he from '@jobswipe/shared/i18n/locales/he.json'

// Add a language here (plus packages/shared/src/i18n/locales/<code>.json and the `resources`
// entry below) and it appears in the language dropdown everywhere.
export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English', dir: 'ltr' },
  { code: 'he', label: 'עב', name: 'עברית', dir: 'rtl' },
] as const
export type LangCode = (typeof LANGUAGES)[number]['code']

function applyDir(lng: string) {
  const dir = LANGUAGES.find((l) => l.code === lng)?.dir ?? 'ltr'
  document.documentElement.lang = lng
  document.documentElement.dir = dir
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, he: { translation: he } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'he'],
    nonExplicitSupportedLngs: true, // "he-IL" → "he"
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'lang' },
    interpolation: { escapeValue: false }, // React already escapes
  })

applyDir(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyDir)

export default i18n
