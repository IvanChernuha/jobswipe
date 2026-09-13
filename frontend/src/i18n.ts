import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import he from './locales/he.json'

export const LANGUAGES = [
  { code: 'en', label: 'EN', dir: 'ltr' },
  { code: 'he', label: 'עב', dir: 'rtl' },
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
