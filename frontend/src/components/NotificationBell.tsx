import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../lib/api'
import type { AppNotification, NotificationType } from '../lib/api'

const TYPE_ICON: Record<NotificationType, string> = {
  match: '💙',
  like_received: '❤️',
  chat: '💬',
  team: '👥',
  account: '🔔',
}

/** Maps a notification's server-chosen title_key/params to a translated string. */
function notifText(t: (key: string, opts?: Record<string, unknown>) => string, n: AppNotification): string {
  const params: Record<string, unknown> = { ...n.params }
  if (typeof params.tag_count === 'number') params.count = params.tag_count

  let key = n.title_key
  if (key === 'notif.team.job_toggled') {
    key = params.active ? 'notif.team.job_toggled_active' : 'notif.team.job_toggled_inactive'
  }
  return t(key, params)
}

function formatRelativeTime(iso: string | null, t: (key: string, opts?: Record<string, unknown>) => string, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return t('notif.time.now')
  if (minutes < 60) return t('notif.time.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('notif.time.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('notif.time.days', { count: days })
  return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' })
}

export default function NotificationBell({
  token,
  unreadCount,
  onCountChange,
}: {
  token: string
  unreadCount: number
  onCountChange: (count: number) => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !loaded) {
      setLoading(true)
      getNotifications(token, { limit: 20 })
        .then((list) => { setItems(list); setLoaded(true) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }

  async function handleItemClick(n: AppNotification) {
    if (!n.read_at) {
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it)))
      onCountChange(Math.max(0, unreadCount - 1))
      markNotificationRead(token, n.id).catch(() => {})
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((it) => (it.read_at ? it : { ...it, read_at: new Date().toISOString() })))
    onCountChange(0)
    try {
      await markAllNotificationsRead(token)
    } catch {
      // silent — next poll reconciles
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggle}
        className="relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        aria-label={unreadCount > 0 ? t('nav.unread', { label: t('notif.bell'), count: unreadCount }) : t('notif.bell')}
        aria-expanded={open}
      >
        <span className="relative text-base sm:text-lg leading-none">
          🔔
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -end-2.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="fixed sm:absolute inset-x-4 sm:inset-x-auto top-16 sm:top-auto sm:end-0 sm:mt-2 w-auto sm:w-96 max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-xl shadow-gray-200 border border-gray-100 z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-gray-900">{t('notif.bell')}</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {t('notif.markAllRead')}
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-8 flex justify-center">
              <div className="w-6 h-6 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">{t('notif.empty')}</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`w-full text-start px-4 py-3 flex items-start gap-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors ${
                      n.read_at ? '' : 'bg-brand-50/50'
                    }`}
                  >
                    <span className="text-lg leading-none shrink-0">{TYPE_ICON[n.type]}</span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm ${n.read_at ? 'text-gray-600' : 'text-gray-900 font-medium'}`} dir="auto">
                        {notifText(t, n)}
                      </span>
                      <span className="block text-xs text-gray-400 mt-0.5">
                        {formatRelativeTime(n.created_at, t, i18n.resolvedLanguage ?? 'en')}
                      </span>
                    </span>
                    {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0 mt-1.5" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
