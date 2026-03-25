import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSwipe } from '../hooks/useSwipe'
import {
  getWorkerFeed, getEmployerFeed, postSwipe, undoLastSwipe, addBookmark, removeBookmark,
  getMyMembership,
  type FeedFilters,
} from '../lib/api'
import SwipeCard, { workerToCard, employerToCard, type CardData } from '../components/SwipeCard'
import MatchModal from '../components/MatchModal'
import ReportModal from '../components/ReportModal'

type AnimDir = 'like' | 'pass' | null

interface MatchState {
  theirName: string
  matchId: string
}

// Module-level cache — survives component unmount/remount on navigation
let cachedCards: CardData[] | null = null
let cachedFilters: string = '{}'

export default function Feed() {
  const { session, role, user } = useAuth()
  const token = session?.access_token ?? ''

  const [cards, setCards] = useState<CardData[]>(cachedCards ?? [])
  const [loading, setLoading] = useState(cachedCards === null)
  const [error, setError] = useState<string | null>(null)
  const [animDir, setAnimDir] = useState<AnimDir>(null)
  const [swiping, setSwiping] = useState(false)
  const [match, setMatch] = useState<MatchState | null>(null)
  const [showReport, setShowReport] = useState(false)

  // Undo state
  const [lastSwiped, setLastSwiped] = useState<CardData | null>(null)
  const [lastSwipeDir, setLastSwipeDir] = useState<'like' | 'pass' | null>(null)
  const [lastWasBookmark, setLastWasBookmark] = useState(false) // bookmark didn't create a swipe
  const [undoing, setUndoing] = useState(false)
  const [undoAnim, setUndoAnim] = useState<'like' | 'pass' | null>(null)

  // Filter state
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<FeedFilters>({})
  const [pendingFilters, setPendingFilters] = useState<FeedFilters>({})

  // Org role — determines what actions are visible
  const [canLike, setCanLike] = useState(true)

  useEffect(() => {
    if (!token || role !== 'employer') return
    getMyMembership(token)
      .then((m) => {
        if (m.has_org && m.role === 'viewer') setCanLike(false)
      })
      .catch(() => {})
  }, [token, role])

  // Prevent double-swipe
  const swipingRef = useRef(false)

  // Sync cards to module-level cache (only cache non-empty)
  useEffect(() => {
    if (cards.length > 0) cachedCards = cards
  }, [cards])

  // ---------------------------------------------------------------------------
  // Load feed
  // ---------------------------------------------------------------------------

  const loadFeed = useCallback(() => {
    if (!token || !role) return

    setLoading(true)
    setError(null)

    const promise =
      role === 'employer'
        ? getEmployerFeed(token, filters).then((data) => data.map(workerToCard))
        : getWorkerFeed(token, filters).then((data) => data.map(employerToCard))

    promise
      .then((mapped) => {
        setCards(mapped)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load feed.')
      })
      .finally(() => setLoading(false))
  }, [token, role, filters])

  useEffect(() => {
    const filtersKey = JSON.stringify(filters)
    // Skip reload if we have cached cards (non-empty) with same filters
    if (cachedCards && cachedCards.length > 0 && cachedFilters === filtersKey) return
    cachedFilters = filtersKey
    loadFeed()
  }, [loadFeed, filters])

  // ---------------------------------------------------------------------------
  // Swipe handler
  // ---------------------------------------------------------------------------

  const handleSwipe = useCallback(
    async (direction: 'like' | 'pass') => {
      if (swipingRef.current || cards.length === 0) return
      swipingRef.current = true
      setSwiping(true)
      setAnimDir(direction)

      const current = cards[0]

      // Wait for animation
      await new Promise((r) => setTimeout(r, 380))

      try {
        const res = await postSwipe(token, {
          target_id: current.id,
          direction,
        })

        if (res.matched) {
          setMatch({ theirName: current.name, matchId: res.match_id! })
        }

        // Store for undo
        setLastSwiped(current)
        setLastSwipeDir(direction)
        setLastWasBookmark(false)
      } catch {
        // Swipe failure is non-fatal — silently move on
      }

      setCards((prev) => prev.slice(1))
      setAnimDir(null)
      setSwiping(false)
      swipingRef.current = false
    },
    [cards, token],
  )

  // ---------------------------------------------------------------------------
  // Undo handler
  // ---------------------------------------------------------------------------

  const handleUndo = useCallback(async () => {
    if (undoing || !lastSwiped) return
    setUndoing(true)

    try {
      if (lastWasBookmark) {
        // Bookmark didn't create a swipe — remove the bookmark and put the card back
        removeBookmark(token, lastSwiped.id).catch(() => {})
        const dir = lastSwipeDir
        setUndoAnim(dir)
        setCards((prev) => [lastSwiped, ...prev])
        setLastSwiped(null)
        setLastSwipeDir(null)
        setLastWasBookmark(false)
        setTimeout(() => setUndoAnim(null), 420)
      } else {
        const res = await undoLastSwipe(token)
        if (res.undone) {
          const dir = lastSwipeDir
          setUndoAnim(dir)
          setCards((prev) => [lastSwiped, ...prev])
          setLastSwiped(null)
          setLastSwipeDir(null)
          setLastWasBookmark(false)
          setTimeout(() => setUndoAnim(null), 420)
        }
      }
    } catch {
      // undo failed silently
    } finally {
      setUndoing(false)
    }
  }, [lastSwiped, lastSwipeDir, lastWasBookmark, token, undoing])

  // Super like handler
  const handleSuperLike = useCallback(async () => {
    if (swipingRef.current || cards.length === 0) return
    swipingRef.current = true
    setSwiping(true)
    setAnimDir('like')

    const current = cards[0]
    await new Promise((r) => setTimeout(r, 380))

    try {
      const res = await postSwipe(token, { target_id: current.id, direction: 'super_like' })
      if (res.matched) setMatch({ theirName: current.name, matchId: res.match_id! })
      setLastSwiped(current)
      setLastSwipeDir('like')
    } catch { /* silent */ }

    setCards((prev) => prev.slice(1))
    setAnimDir(null)
    setSwiping(false)
    swipingRef.current = false
  }, [cards, token])

  // Bookmark state
  const [bookmarkFlash, setBookmarkFlash] = useState(false)

  // Bookmark handler — saves and auto-swipes to next card
  const handleBookmark = useCallback(async () => {
    if (swipingRef.current || cards.length === 0) return
    swipingRef.current = true
    setSwiping(true)

    const current = cards[0]

    try {
      await addBookmark(token, current.id)
    } catch { /* already bookmarked */ }

    setBookmarkFlash(true)
    setTimeout(() => setBookmarkFlash(false), 1200)

    // Slide card out to the right (like a like)
    setAnimDir('like')
    await new Promise((r) => setTimeout(r, 380))

    setLastSwiped(current)
    setLastSwipeDir('like')
    setLastWasBookmark(true)
    setCards((prev) => prev.slice(1))
    setAnimDir(null)
    setSwiping(false)
    swipingRef.current = false
  }, [cards, token])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (match || loading) return
      if (e.key === 'b' || e.key === 'B') handleBookmark()
      if (e.key === 'x' || e.key === 'X') handleSwipe('pass')
      if (e.key === 'z' || e.key === 'Z') handleUndo()
      if (!canLike) return // Viewer: no like/super
      if (e.key === 'v' || e.key === 'V') handleSwipe('like')
      else if (e.key === 's' || e.key === 'S') handleSuperLike()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleSuperLike, handleBookmark, handleSwipe, match, loading, canLike])

  // Disable the useSwipe hook's own V/X handling — we handle it above
  useSwipe(handleSwipe, false)

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------

  const applyFilters = () => {
    cachedCards = null // Force reload with new filters
    setFilters({ ...pendingFilters })
    setShowFilters(false)
    setLastSwiped(null)
  }

  const clearFilters = () => {
    cachedCards = null // Force reload
    setPendingFilters({})
    setFilters({})
    setShowFilters(false)
    setLastSwiped(null)
  }

  const hasActiveFilters = Object.values(filters).some((v) => v != null && v !== '')

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Finding profiles…</p>
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell>
        <div className="max-w-sm w-full bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <p className="text-red-700 font-medium mb-3">Failed to load feed</p>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary text-sm"
          >
            Retry
          </button>
        </div>
      </PageShell>
    )
  }

  if (cards.length === 0) {
    return (
      <PageShell>
        <FeedToolbar
          hasActiveFilters={hasActiveFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
          onUndo={handleUndo}
          canUndo={!!lastSwiped && !undoing}
        />
        {showFilters && (
          <FilterPanel
            role={role}
            filters={pendingFilters}
            onChange={setPendingFilters}
            onApply={applyFilters}
            onClear={clearFilters}
          />
        )}
        <EmptyState role={role} hasFilters={hasActiveFilters} onClear={clearFilters} />
      </PageShell>
    )
  }

  const topCard = cards[0]
  const nextCard = cards[1] ?? null

  return (
    <PageShell>
      {/* Bookmark toast */}
      {bookmarkFlash && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2">
            <span>&#x2691;</span> Saved for later
          </div>
        </div>
      )}

      {/* Report modal */}
      {showReport && cards.length > 0 && (
        <ReportModal
          targetId={cards[0].id}
          targetType={role === 'worker' ? 'job' : 'user'}
          token={token}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Match modal */}
      {match && (
        <MatchModal
          myName={user?.email ?? 'You'}
          theirName={match.theirName}
          matchId={match.matchId}
          onClose={() => setMatch(null)}
        />
      )}

      <div className="flex flex-col items-center gap-6 py-8 px-4 w-full">
        {/* Toolbar: filters + undo */}
        <FeedToolbar
          hasActiveFilters={hasActiveFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
          onUndo={handleUndo}
          canUndo={!!lastSwiped && !undoing}
        />

        {/* Filter panel */}
        {showFilters && (
          <FilterPanel
            role={role}
            filters={pendingFilters}
            onChange={setPendingFilters}
            onApply={applyFilters}
            onClear={clearFilters}
          />
        )}

        {/* Keyboard hint */}
        <p className="text-xs text-gray-400 flex items-center gap-4 flex-wrap justify-center">
          <span>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">X</kbd>
            &nbsp;pass
          </span>
          {canLike && (
            <>
              <span>
                <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">V</kbd>
                &nbsp;like
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">S</kbd>
                &nbsp;super
              </span>
            </>
          )}
          <span>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">B</kbd>
            &nbsp;save
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">Z</kbd>
            &nbsp;undo
          </span>
        </p>

        {/* Card stack */}
        <div className="relative w-full max-w-sm" style={{ height: 480 }}>
          {/* Background card (next) */}
          {nextCard && (
            <div
              className="absolute inset-0 top-3 scale-95 opacity-60 pointer-events-none"
              style={{ zIndex: 0 }}
            >
              <SwipeCard card={nextCard} />
            </div>
          )}

          {/* Top card */}
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            <SwipeCard
              card={topCard}
              overlayDir={animDir}
              animClass={
                animDir === 'like'
                  ? 'animate-slide-right'
                  : animDir === 'pass'
                    ? 'animate-slide-left'
                    : undoAnim === 'like'
                      ? 'animate-slide-in-from-right'
                      : undoAnim === 'pass'
                        ? 'animate-slide-in-from-left'
                        : undefined
              }
            />
          </div>
        </div>

        {/* Remaining count + report */}
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400">
            {cards.length} profile{cards.length !== 1 ? 's' : ''} remaining
          </p>
          <button
            onClick={() => setShowReport(true)}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            title="Report this profile"
          >
            Report
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-4">
          {/* Pass — always visible */}
          <SwipeButton
            onClick={() => handleSwipe('pass')}
            disabled={swiping}
            label="Pass"
            variant="pass"
          />

          {/* Bookmark button — always visible */}
          <button
            onClick={handleBookmark}
            disabled={swiping || cards.length === 0}
            aria-label="Bookmark"
            className={`w-11 h-11 text-base
                       rounded-full flex items-center justify-center
                       border-2 shadow-lg transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed
                       ${bookmarkFlash
                         ? 'bg-blue-500 text-white border-blue-500 shadow-blue-300 scale-110'
                         : 'bg-white text-blue-500 border-blue-300 hover:bg-blue-50 shadow-blue-100 hover:shadow-blue-200'
                       }`}
          >
            &#x2691;
          </button>

          {/* Undo button — always visible */}
          <button
            onClick={handleUndo}
            disabled={!lastSwiped || undoing}
            aria-label="Undo"
            className="w-11 h-11 rounded-full flex items-center justify-center text-base
                       bg-white text-amber-500 border-2 border-amber-300 hover:bg-amber-50
                       shadow-lg shadow-amber-100 hover:shadow-amber-200
                       transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↩
          </button>

          {canLike && (
            <>
              <SwipeButton
                onClick={() => handleSwipe('like')}
                disabled={swiping}
                label="Like"
                variant="like"
              />

              {/* Super like button */}
              <button
                onClick={handleSuperLike}
                disabled={swiping}
                aria-label="Super Like"
                className="w-14 h-14 rounded-full flex items-center justify-center text-xl
                           bg-white text-yellow-500 border-2 border-yellow-400 hover:bg-yellow-50
                           shadow-lg shadow-yellow-100 hover:shadow-yellow-200
                           transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                &#9733;
              </button>
            </>
          )}
        </div>
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center">
      {children}
    </div>
  )
}

function FeedToolbar({
  hasActiveFilters,
  onToggleFilters,
  onUndo,
  canUndo,
}: {
  hasActiveFilters: boolean
  onToggleFilters: () => void
  onUndo: () => void
  canUndo: boolean
}) {
  return (
    <div className="flex items-center gap-3 w-full max-w-sm px-4">
      <button
        onClick={onToggleFilters}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
          ${hasActiveFilters
            ? 'bg-brand-50 text-brand-700 border-brand-300'
            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
          }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filters
        {hasActiveFilters && (
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
        )}
      </button>
      <div className="flex-1" />
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border
                   bg-white text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-600
                   transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ↩ Undo
      </button>
    </div>
  )
}

function FilterPanel({
  role,
  filters,
  onChange,
  onApply,
  onClear,
}: {
  role: string | null
  filters: FeedFilters
  onChange: (f: FeedFilters) => void
  onApply: () => void
  onClear: () => void
}) {
  const isWorker = role === 'worker'

  return (
    <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
      {/* Location */}
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Location</label>
        <input
          type="text"
          placeholder="e.g. New York, Remote..."
          value={filters.location ?? ''}
          onChange={(e) => onChange({ ...filters, location: e.target.value || undefined })}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
      </div>

      {isWorker ? (
        <>
          {/* Salary minimum */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">
              Minimum salary {filters.salary_min ? `($${(filters.salary_min / 1000).toFixed(0)}k+)` : ''}
            </label>
            <input
              type="range"
              min={0}
              max={300000}
              step={10000}
              value={filters.salary_min ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange({ ...filters, salary_min: v > 0 ? v : undefined })
              }}
              className="w-full accent-brand-500"
            />
          </div>

          {/* Remote toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.remote ?? false}
              onChange={(e) => onChange({ ...filters, remote: e.target.checked || undefined })}
              className="rounded border-gray-300 text-brand-500 focus:ring-brand-300"
            />
            <span className="text-sm text-gray-700">Remote only</span>
          </label>
        </>
      ) : (
        <>
          {/* Experience range */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Min experience (yrs)</label>
              <input
                type="number"
                min={0}
                max={50}
                placeholder="0"
                value={filters.experience_min ?? ''}
                onChange={(e) => onChange({ ...filters, experience_min: e.target.value ? Number(e.target.value) : undefined })}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">Max experience (yrs)</label>
              <input
                type="number"
                min={0}
                max={50}
                placeholder="50"
                value={filters.experience_max ?? ''}
                onChange={(e) => onChange({ ...filters, experience_max: e.target.value ? Number(e.target.value) : undefined })}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
          </div>
        </>
      )}

      {/* Apply / Clear */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApply}
          className="flex-1 px-3 py-1.5 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors"
        >
          Apply
        </button>
        <button
          onClick={onClear}
          className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

function SwipeButton({
  onClick,
  disabled,
  label,
  variant,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  variant: 'like' | 'pass'
}) {
  const isLike = variant === 'like'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl
                  shadow-lg transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed
                  ${isLike
                    ? 'bg-white text-green-500 border-2 border-green-400 hover:bg-green-50 shadow-green-100 hover:shadow-green-200'
                    : 'bg-white text-red-400 border-2 border-red-300 hover:bg-red-50 shadow-red-100 hover:shadow-red-200'
                  }`}
    >
      {isLike ? '✓' : '✗'}
    </button>
  )
}

function EmptyState({ role, hasFilters, onClear }: { role: string | null; hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 px-6 text-center">
      <div className="text-6xl">{hasFilters ? '🔍' : '🌟'}</div>
      <h2 className="text-xl font-bold text-gray-800">
        {hasFilters ? 'No matches for your filters' : "You're all caught up!"}
      </h2>
      <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
        {hasFilters
          ? 'Try broadening your filters to see more results.'
          : `No more ${role === 'employer' ? 'worker' : 'employer'} profiles right now. Check back soon — new people join every day.`
        }
      </p>
      {hasFilters && (
        <button onClick={onClear} className="btn-primary text-sm">
          Clear filters
        </button>
      )}
    </div>
  )
}
