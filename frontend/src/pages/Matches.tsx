import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getMatches, getMatch, getUnreadCounts } from '../lib/api'
import type { Match, UnreadCount } from '../lib/api'

export default function Matches() {
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''

  const navigate = useNavigate()
  const [matches, setMatches] = useState<Match[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
        setError(err instanceof Error ? err.message : 'Failed to load matches.')
      })
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading matches…</p>
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell>
        <div className="max-w-sm mx-auto bg-red-50 border border-red-200 rounded-2xl p-6 text-center mt-10">
          <p className="text-red-700 font-medium mb-2">Failed to load matches</p>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </PageShell>
    )
  }

  if (matches.length === 0) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-4 py-20 text-center px-6">
          <span className="text-6xl">💙</span>
          <h2 className="text-xl font-bold text-gray-800">No matches yet</h2>
          <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
            Keep swiping — your perfect match is out there!
          </p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="max-w-2xl w-full px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Your Matches{' '}
          <span className="text-brand-500 text-lg font-semibold">({matches.length})</span>
        </h1>

        <div className="space-y-3">
          {matches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              role={role}
              token={token}
              unreadCount={unread[m.id] ?? 0}
              onChat={() => navigate(`/chat/${m.id}`)}
            />
          ))}
        </div>
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
}: {
  match: Match
  role: string | null
  token: string
  unreadCount: number
  onChat: () => void
}) {
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
    ? match.employer?.company_name ?? 'Unknown Employer'
    : match.worker?.name ?? 'Unknown Worker'

  const avatarUrl = (role === 'worker' ? match.employer : match.worker)?.avatar_url ?? null
  const subtitle =
    role === 'worker'
      ? match.employer?.job_title ?? ''
      : match.worker?.experience_years != null
        ? `${match.worker.experience_years} yrs exp`
        : ''

  const initials = name
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const matchDate = new Date(match.matched_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4
                    hover:shadow-md transition-shadow">
      {/* Avatar */}
      <div className="relative w-14 h-14 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center">
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-bold text-white">{initials}</span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 truncate">{name}</p>
        {subtitle && <p className="text-sm text-gray-500 truncate">{subtitle}</p>}
        <p className="text-xs text-gray-400 mt-0.5">Matched {matchDate}</p>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {/* Chat button */}
        <button
          onClick={onChat}
          className="relative w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center
                     hover:bg-brand-100 transition-colors"
          aria-label="Chat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
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
          <span className="text-xs text-red-500">Error</span>
        ) : (
          <button
            onClick={handleReveal}
            disabled={loadingContact}
            className="btn-primary text-xs py-1.5 px-3"
          >
            {loadingContact ? '...' : 'Email'}
          </button>
        )}
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
