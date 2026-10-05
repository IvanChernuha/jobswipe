import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { amIAdmin, getUnreadCounts, getUnreadNotificationCount } from '../lib/api'
import { useTranslation } from 'react-i18next'
import LangToggle from './LangToggle'
import NotificationBell from './NotificationBell'
import Icon, { type IconName } from './Icon'

interface NavEntry {
  to: string
  label: string
  icon: IconName
  badge?: number
}

export default function Navbar() {
  const { t } = useTranslation()
  const { signOut, role, session } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const token = session?.access_token ?? ''
  const isChat = pathname.startsWith('/chat/')

  // Unread chat badge on Matches + unread notification count; one combined poll.
  const [unread, setUnread] = useState(0)
  const [notifUnread, setNotifUnread] = useState(0)
  useEffect(() => {
    if (!token) return
    let stopped = false
    const load = () =>
      Promise.all([getUnreadCounts(token), getUnreadNotificationCount(token)])
        .then(([counts, notif]) => {
          if (stopped) return
          setUnread(counts.reduce((n, c) => n + c.count, 0))
          setNotifUnread(notif.count)
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => { stopped = true; clearInterval(id) }
  }, [token])

  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    if (!token) return
    amIAdmin(token).then((r) => setIsAdmin(r.admin)).catch(() => {})
  }, [token])

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  const items: NavEntry[] = [
    { to: '/feed', label: t('nav.feed'), icon: 'compass' },
    ...(role === 'employer'
      ? [
          { to: '/jobs', label: t('nav.jobs'), icon: 'clipboard' as IconName },
          { to: '/team', label: t('nav.team'), icon: 'users' as IconName },
        ]
      : []),
    { to: '/saved', label: t('nav.saved'), icon: 'bookmark' },
    { to: '/matches', label: t('nav.matches'), icon: 'message', badge: unread },
    { to: '/profile', label: t('nav.profile'), icon: role === 'employer' ? 'building' : 'user' },
  ]

  return (
    <>
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <Link to="/feed" className="flex items-center gap-2.5 shrink-0" aria-label="JobSwipe home">
            <span className="w-8 h-8 rounded-lg bg-brand-500 text-white flex items-center justify-center">
              <Icon name="briefcase" className="w-4 h-4" />
            </span>
            <span className="font-display text-lg font-semibold text-gray-900 tracking-tight">JobSwipe</span>
          </Link>

          <div className="hidden lg:flex items-center gap-1">
            {items.map((it) => <NavItem key={it.to} {...it} />)}
            {isAdmin && <NavItem to="/admin" label={t('nav.admin')} icon="shield" />}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isAdmin && (
              <NavLink
                to="/admin"
                aria-label={t('nav.admin')}
                className={({ isActive }) =>
                  `lg:hidden w-11 h-11 rounded-lg flex items-center justify-center ${isActive ? 'text-brand-600 bg-brand-50' : 'text-gray-600'}`
                }
              >
                <Icon name="shield" className="w-5 h-5" />
              </NavLink>
            )}
            {token && <NotificationBell token={token} unreadCount={notifUnread} onCountChange={setNotifUnread} />}
            <LangToggle className="hidden lg:inline-flex" />
            <button
              onClick={handleSignOut}
              className="btn-ghost text-sm min-w-[44px] min-h-[44px] px-2 xl:px-3"
              title={t('nav.signOut')}
              aria-label={t('nav.signOut')}
            >
              <span className="hidden xl:inline">{t('nav.signOut')}</span>
              <Icon name="logOut" className="xl:hidden w-5 h-5 rtl:-scale-x-100" />
            </button>
          </div>
        </div>
      </nav>

      {!isChat && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((it) => <TabItem key={it.to} {...it} />)}
          </div>
        </div>
      )}
    </>
  )
}

function NavItem({ to, label, icon, badge = 0 }: NavEntry) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={to}
      aria-label={badge > 0 ? t('nav.unread', { label, count: badge }) : label}
      className={({ isActive }) =>
        `flex items-center gap-2 h-10 px-3 rounded-lg text-sm font-medium transition-colors
         ${isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`
      }
    >
      <span className="relative">
        <Icon name={icon} className="w-[18px] h-[18px]" />
        <Badge count={badge} />
      </span>
      <span>{label}</span>
    </NavLink>
  )
}

function TabItem({ to, label, icon, badge = 0 }: NavEntry) {
  const { t } = useTranslation()
  return (
    <NavLink
      to={to}
      aria-label={badge > 0 ? t('nav.unread', { label, count: badge }) : label}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-1 h-14 text-[10px] font-medium transition-colors
         ${isActive ? 'text-brand-600' : 'text-gray-500'}`
      }
    >
      <span className="relative">
        <Icon name={icon} className="w-6 h-6" />
        <Badge count={badge} />
      </span>
      <span>{label}</span>
    </NavLink>
  )
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -top-1.5 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4 text-center">
      {count > 99 ? '99+' : count}
    </span>
  )
}
