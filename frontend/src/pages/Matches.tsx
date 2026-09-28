import { useState, useEffect } from 'react'
import Icon from '../components/Icon'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { getMatches, getMatch, getUnreadCounts } from '../lib/api'
import type { Match, UnreadCount } from '../lib/api'
import ReportModal from '../components/ReportModal'

export default function Matches() {
  const { t } = useTranslation()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''

  const navigate = useNavigate()
  const [matches, setMatches] = useState<Match[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null)
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null)
  useEffect(() => {
    if (!token) return
    setLoading(true)
    Promise.all([getMatches(token), getUnreadCounts(token)])
      .then(([m, counts]) => {
        setMatches(m)
        const map: Record<string, number> = {}
        counts.forEach((c: UnreadCount) => { map[c.match_id] = c.count })
        setUnread(map)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('matches.failedToLoadShort'))
      })
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">{t('matches.loading')}</p>
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell>
        <div className="max-w-sm mx-auto bg-red-50 border border-red-200 rounded-2xl p-6 text-center mt-10">
          <p className="text-red-700 font-medium mb-2">{t('matches.failedToLoad')}</p>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </PageShell>
    )
  }

  if (matches.length === 0) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-4 py-20 text-center px-6">
          {notice && <p className="text-sm text-white bg-gray-900 rounded-xl px-4 py-3" role="status">{notice}</p>}
          <Icon name="message" className="w-14 h-14 text-brand-300" />
          <h2 className="text-xl font-bold text-gray-800">{t('matches.emptyTitle')}</h2>
          <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
            {t('matches.emptyHint')}
          </p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="max-w-2xl w-full px-4 py-8">
        {notice && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-gray-900 text-white px-4 py-3 text-sm" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="font-bold" aria-label={t('common.dismiss')}>&times;</button>
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {t('matches.yourMatches')}{' '}
          <span className="text-brand-500 text-lg font-semibold">({matches.length})</span>
        </h1>

        <div className="space-y-3">
          {matches.map((m) => {
            const otherId = role === 'worker' ? m.employer_id : m.worker_id
            const otherName = role === 'worker'
              ? m.employer?.company_name ?? t('matches.user')
              : m.worker?.name ?? t('matches.user')
            return (
              <MatchCard
                key={m.id}
                match={m}
                role={role}
                token={token}
                unreadCount={unread[m.id] ?? 0}
                onChat={() => navigate(`/chat/${m.id}`)}
                onReport={() => setReportTarget({ id: otherId, name: otherName })}
              />
            )
          })}
        </div>

        {reportTarget && (
          <ReportModal
            targetId={reportTarget.id}
            targetType="user"
            token={token}
            onClose={() => setReportTarget(null)}
            onBlocked={() => {
              const id = reportTarget?.id
              if (id) setMatches((prev) => prev.filter((m) => m.worker_id !== id && m.employer_id !== id))
              setNotice(t('feed.reportedAndBlocked'))
            }}
          />
        )}
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Individual match card
// ---------------------------------------------------------------------------

function MatchCard({
  match,
  role,
  token,
  unreadCount,
  onChat,
  onReport,
}: {
  match: Match
  role: string | null
  token: string
  unreadCount: number
  onChat: () => void
  onReport: () => void
}) {
  const { t, i18n } = useTranslation()
  const [contactEmail, setContactEmail] = useState<string | null>(null)
  const [loadingContact, setLoadingContact] = useState(false)
  const [contactError, setContactError] = useState(false)

  async function handleReveal() {
    setLoadingContact(true)
    setContactError(false)
    try {
      const detail = await getMatch(token, match.id)
      setContactEmail(detail.contact_email ?? null)
    } catch {
      setContactError(true)
    } finally {
      setLoadingContact(false)
    }
  }
  // For a worker, show the employer side; for an employer, show the worker side
  const name = role === 'worker'
    ? match.employer?.company_name ?? t('matches.unknownEmployer')
    : match.worker?.name ?? t('matches.unknownWorker')

  const avatarUrl = (role === 'worker' ? match.employer : match.worker)?.avatar_url ?? null
  const subtitle =
    role === 'worker'
      ? match.employer?.job_title ?? ''
      : match.worker?.experience_years != null
        ? t('matches.yrsExp', { count: match.worker.experience_years })
        : ''

  const initials = name
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const matchDate = new Date(match.matched_at).toLocaleDateString(i18n.resolvedLanguage ?? 'en', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4
                    hover:shadow-md transition-shadow">
     <div className="flex items-center gap-4 min-w-0 flex-1">
      {/* Avatar */}
      <div className="relative w-14 h-14 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center">
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-bold text-white">{initials}</span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -end-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p dir="auto" className="font-semibold text-gray-900 break-words">{name}</p>
        {subtitle && <p dir="auto" className="text-sm text-gray-500 truncate">{subtitle}</p>}
        <p className="text-xs text-gray-400 mt-0.5">{t('matches.matchedOn', { date: matchDate })}</p>
      </div>
     </div>

      {/* Actions */}
      <div className="flex items-center gap-2 sm:shrink-0">
        <button
          onClick={onChat}
          className="h-11 px-4 rounded-full bg-brand-500 text-white text-sm font-semibold flex items-center gap-2
                     hover:bg-brand-600 transition-colors"
        >
          <Icon name="message" className="w-4 h-4" />
          {t('matches.chat')}
        </button>

        {/* Contact reveal */}
        {contactEmail ? (
          <a
            href={`mailto:${contactEmail}`}
            className="text-xs font-medium text-brand-600 hover:underline max-w-[120px] truncate"
          >
            {contactEmail}
          </a>
        ) : contactError ? (
          <span className="text-xs text-red-500">{t('matches.error')}</span>
        ) : (
          <button
            onClick={handleReveal}
            disabled={loadingContact}
            className="btn-secondary text-xs min-h-[44px] px-3"
          >
            {loadingContact ? '...' : t('matches.email')}
          </button>
        )}

        {/* Report */}
        <button
          onClick={(e) => { e.stopPropagation(); onReport(); }}
          className="w-11 h-11 ms-auto sm:ms-0 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
          title={t('common.report')}
          aria-label={t('common.report')}
        >
          <Icon name="flag" className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center">
      {children}
    </div>
  )
}
