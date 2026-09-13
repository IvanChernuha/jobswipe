import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getUnreadCounts } from '../lib/api'
import { useTranslation } from 'react-i18next'
import LangToggle from './LangToggle'

export default function Navbar() {
  const { t } = useTranslation()
  const { signOut, role, session } = useAuth()
  const navigate = useNavigate()
  const token = session?.access_token ?? ''

  // Unread chat badge on Matches; polled lightly, never fatal.
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!token) return
    let stopped = false
    const load = () =>
      getUnreadCounts(token)
        .then((counts) => { if (!stopped) setUnread(counts.reduce((n, c) => n + c.count, 0)) })
        .catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => { stopped = true; clearInterval(id) }
  }, [token])

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm shadow-gray-50">
      <div className="max-w-5xl mx-auto px-2 sm:px-6 h-14 flex items-center justify-between gap-1">
        {/* Logo — wordmark hidden on phones so six nav items fit at 360px */}
        <Link to="/feed" className="flex items-center gap-2 font-bold text-lg text-gray-900 shrink-0" aria-label="JobSwipe home">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center">
            <span className="text-sm">💼</span>
          </div>
          <span className="hidden md:inline">
            Job<span className="text-brand-500">Swipe</span>
          </span>
        </Link>

        {/* Centre links: icon + small label on phones, icon + text on desktop */}
        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
          <NavItem to="/feed" label={t('nav.feed')} icon="🔍" />
          {role === 'employer' && <NavItem to="/jobs" label={t('nav.jobs')} icon="📋" />}
          {role === 'employer' && <NavItem to="/team" label={t('nav.team')} icon="👥" />}
          <NavItem to="/saved" label={t('nav.saved')} icon="&#x2691;" />
          <NavItem to="/matches" label={t('nav.matches')} icon="💙" badge={unread} />
          <NavItem to="/profile" label={t('nav.profile')} icon={role === 'employer' ? '🏢' : '👤'} />
        </div>

        {/* Language + sign out */}
        <div className="flex items-center gap-1 shrink-0">
        <LangToggle className="hidden sm:inline-flex" />
        <button
          onClick={handleSignOut}
          className="btn-ghost text-sm py-1.5 px-2 sm:px-3 shrink-0"
          title={t('nav.signOut')}
          aria-label={t('nav.signOut')}
        >
          <span className="hidden sm:inline">{t('nav.signOut')}</span>
          <svg className="sm:hidden w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
        </div>
      </div>
    </nav>
  )
}

function NavItem({ to, label, icon, badge = 0 }: { to: string; label: string; icon: string; badge?: number }) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={to}
      aria-label={badge > 0 ? t('nav.unread', { label, count: badge }) : label}
      className={({ isActive }) =>
        `flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-1.5
         min-w-[44px] min-h-[44px] px-1.5 sm:px-3 py-0.5 sm:py-1.5 rounded-xl
         text-[10px] sm:text-sm font-medium leading-tight transition-colors
         ${isActive
           ? 'bg-brand-50 text-brand-600'
           : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
         }`
      }
    >
      <span className="relative text-base sm:text-sm leading-none">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1.5 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span>{label}</span>
    </NavLink>
  )
}
