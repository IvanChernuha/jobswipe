import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n'

/** EN / עב switch. Compact enough for the navbar and the auth pages. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage ?? 'en'
  return (
    <div className={`inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-semibold ${className}`} role="group" aria-label={t('common.language')}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => i18n.changeLanguage(l.code)}
          className={`min-w-[36px] min-h-[32px] px-2 rounded-md transition-colors ${
            current === l.code ? 'bg-brand-500 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
          aria-pressed={current === l.code}
          lang={l.code}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
