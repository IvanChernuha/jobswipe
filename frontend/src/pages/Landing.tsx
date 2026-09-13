import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LangToggle from '../components/LangToggle'

export default function Landing() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-50 via-white to-purple-50">
      {/* Hero */}
      <header className="relative flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="absolute end-4 top-4"><LangToggle /></div>
        {/* Logo mark */}
        <div className="mb-6 w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-200">
          <span className="text-4xl">💼</span>
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-gray-900 mb-4">
          Job<span className="text-brand-500">Swipe</span>
        </h1>

        <p className="max-w-xl text-lg sm:text-xl text-gray-600 mb-10 leading-relaxed">
          {t('landing.tagline1')}
          <br />
          {t('landing.tagline2')}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm sm:max-w-none sm:w-auto">
          <Link
            to="/register?role=worker"
            className="btn-primary text-base px-8 py-3 rounded-2xl shadow-md shadow-brand-200
                       hover:shadow-lg hover:shadow-brand-300 transition-shadow"
          >
            {t('landing.ctaWorker')}
          </Link>
          <Link
            to="/register?role=employer"
            className="btn-secondary text-base px-8 py-3 rounded-2xl
                       hover:border-brand-300 hover:text-brand-600 transition-colors"
          >
            {t('landing.ctaEmployer')}
          </Link>
        </div>

        <p className="mt-6 text-sm text-gray-500">
          {t('landing.haveAccount')}{' '}
          <Link to="/login" className="text-brand-600 font-medium hover:underline">
            {t('common.signIn')}
          </Link>
        </p>
      </header>

      {/* Feature strip */}
      <section className="border-t border-gray-100 bg-white/70 backdrop-blur py-12 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          <Feature
            emoji="⚡"
            title={t('landing.feature1Title')}
            desc={t('landing.feature1Desc')}
          />
          <Feature
            emoji="🎯"
            title={t('landing.feature2Title')}
            desc={t('landing.feature2Desc')}
          />
          <Feature
            emoji="🔑"
            title={t('landing.feature3Title')}
            desc={t('landing.feature3Desc')}
          />
        </div>
      </section>

      <footer className="py-6 text-center text-xs text-gray-400">
        {t('landing.footer', { year: new Date().getFullYear() })}
      </footer>
    </div>
  )
}

function Feature({
  emoji,
  title,
  desc,
}: {
  emoji: string
  title: string
  desc: string
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-3xl">{emoji}</span>
      <h3 className="font-semibold text-gray-800">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
    </div>
  )
}
