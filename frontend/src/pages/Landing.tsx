import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LangToggle from '../components/LangToggle'
import Icon, { type IconName } from '../components/Icon'

export default function Landing() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="flex items-center justify-between px-5 sm:px-10 h-16">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-brand-500 text-white flex items-center justify-center">
            <Icon name="briefcase" className="w-4 h-4" />
          </span>
          <span className="font-display text-xl font-semibold text-gray-900 tracking-tight">JobSwipe</span>
        </div>
        <div className="flex items-center gap-4">
          <LangToggle />
          <Link to="/login" className="hidden sm:inline text-sm font-semibold text-gray-900 hover:text-brand-600">
            {t('common.signIn')}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-14 text-center">
        <h1 className="max-w-3xl text-4xl sm:text-6xl font-semibold text-gray-900 leading-[1.08] mb-5">
          {t('landing.tagline1')}
        </h1>
        <p className="max-w-xl text-lg sm:text-xl text-gray-500 mb-10 leading-relaxed">
          {t('landing.tagline2')}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm sm:max-w-none sm:w-auto">
          <Link to="/register?role=worker" className="btn-primary text-base px-8 py-3.5">
            {t('landing.ctaWorker')}
          </Link>
          <Link to="/register?role=employer" className="btn-secondary text-base px-8 py-3.5">
            {t('landing.ctaEmployer')}
          </Link>
        </div>

        <p className="mt-6 text-sm text-gray-500">
          {t('landing.haveAccount')}{' '}
          <Link to="/login" className="text-brand-600 font-semibold hover:underline">
            {t('common.signIn')}
          </Link>
        </p>
      </section>

      {/* Feature strip */}
      <section className="border-t border-gray-200 bg-white py-10 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
          <Feature icon="zap" title={t('landing.feature1Title')} desc={t('landing.feature1Desc')} />
          <Feature icon="target" title={t('landing.feature2Title')} desc={t('landing.feature2Desc')} />
          <Feature icon="key" title={t('landing.feature3Title')} desc={t('landing.feature3Desc')} />
        </div>
      </section>

      <footer className="bg-white border-t border-gray-200 py-5 text-center text-xs text-gray-500">
        {t('landing.footer', { year: new Date().getFullYear() })}
      </footer>
    </div>
  )
}

function Feature({ icon, title, desc }: { icon: IconName; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-4 text-start">
      <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 leading-relaxed mt-0.5">{desc}</p>
      </div>
    </div>
  )
}
