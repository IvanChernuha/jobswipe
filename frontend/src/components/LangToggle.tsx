import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n'
import Icon from './Icon'

/** Language dropdown, fed by LANGUAGES in i18n.ts. */
export default function LangToggle({ className = 'inline-flex' }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage ?? 'en'
  return (
    <label className={`relative items-center ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <Icon name="globe" className="w-4 h-4 absolute start-2.5 text-gray-500 pointer-events-none" />
      <select
        value={current}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="h-11 ps-8 pe-7 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700
                   appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>
        ))}
      </select>
      <Icon name="chevronDown" className="w-3.5 h-3.5 absolute end-2 text-gray-500 pointer-events-none" />
    </label>
  )
}
