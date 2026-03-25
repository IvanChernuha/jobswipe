import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  getBookmarks, removeBookmark, postSwipe, moveBookmark, updateBookmarkNote,
  getJobPostings, getMyMembership,
  type Tag, type JobPosting,
} from '../lib/api'
import TagBadge from '../components/TagBadge'

interface EnrichedBookmark {
  id: string
  target_id: string
  created_at: string
  expires_at: string
  job_posting_id: string | null
  note: string
  name?: string | null
  avatar_url?: string | null
  bio?: string | null
  location?: string | null
  experience_years?: number | null
  skills?: string[] | null
  job_title?: string | null
  company_name?: string | null
  description?: string | null
  salary_min?: number | null
  salary_max?: number | null
  remote?: boolean | null
  tags?: Tag[]
}

interface EnrichedGroup {
  job_posting_id: string | null
  job_title: string
  bookmarks: EnrichedBookmark[]
}

export default function Bookmarks() {
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''

  const [groups, setGroups] = useState<EnrichedGroup[]>([])
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [canLike, setCanLike] = useState(true)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    const promises: Promise<unknown>[] = [
      getBookmarks(token).then((data) => setGroups(data as unknown as EnrichedGroup[])),
    ]
    if (role === 'employer') {
      promises.push(getJobPostings(token).then(setJobs).catch(() => {}))
      promises.push(getMyMembership(token).then((m) => {
        if (m.has_org && m.role === 'viewer') setCanLike(false)
      }).catch(() => {}))
    }
    Promise.all(promises)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token, role])

  function removeFromGroups(targetId: string) {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, bookmarks: g.bookmarks.filter((b) => b.target_id !== targetId) }))
        .filter((g) => g.bookmarks.length > 0),
    )
  }

  async function handleRemove(targetId: string) {
    try {
      await removeBookmark(token, targetId)
      removeFromGroups(targetId)
    } catch { /* silent */ }
  }

  async function handleSwipe(targetId: string, direction: 'like' | 'pass') {
    try {
      await postSwipe(token, { target_id: targetId, direction })
      await removeBookmark(token, targetId).catch(() => {})
    } catch { /* already swiped */ }
    removeFromGroups(targetId)
  }

  async function handleMove(targetId: string, jobPostingId: string | null) {
    try {
      await moveBookmark(token, targetId, jobPostingId)
      // Reload to get fresh grouping
      const data = await getBookmarks(token)
      setGroups(data as unknown as EnrichedGroup[])
    } catch { /* silent */ }
  }

  async function handleNote(targetId: string, note: string) {
    try {
      await updateBookmarkNote(token, targetId, note)
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          bookmarks: g.bookmarks.map((b) => (b.target_id === targetId ? { ...b, note } : b)),
        })),
      )
    } catch { /* silent */ }
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading saved...</p>
        </div>
      </Shell>
    )
  }

  const totalCount = groups.reduce((sum, g) => sum + g.bookmarks.length, 0)

  if (totalCount === 0) {
    return (
      <Shell>
        <div className="text-center py-16">
          <p className="text-5xl mb-3">&#x2691;</p>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No saved profiles yet</h2>
          <p className="text-gray-500 text-sm">
            Press the flag button or <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500 font-mono text-xs">B</kbd> while browsing to save profiles for later.
          </p>
        </div>
      </Shell>
    )
  }

  const isEmployer = role === 'employer'

  return (
    <Shell>
      <div className="max-w-2xl w-full px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Saved</h1>
        <p className="text-sm text-gray-500 mb-6">{totalCount} saved profile{totalCount !== 1 ? 's' : ''}</p>

        <div className="space-y-6">
          {groups.map((group) => {
            const key = group.job_posting_id ?? '__unsorted'
            const isOpen = !collapsed.has(key)
            return (
              <div key={key}>
                {/* Group header */}
                {isEmployer && (
                  <button
                    onClick={() => toggleCollapse(key)}
                    className="flex items-center gap-2 w-full mb-3 group"
                  >
                    <span className={`text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                    <h2 className="text-sm font-semibold text-gray-700 group-hover:text-gray-900 transition-colors">
                      {group.job_title}
                    </h2>
                    <span className="text-xs text-gray-400">({group.bookmarks.length})</span>
                  </button>
                )}

                {/* Cards */}
                {isOpen && (
                  <div className="space-y-4">
                    {group.bookmarks.map((bm) => (
                      <BookmarkCard
                        key={bm.id}
                        bookmark={bm}
                        role={role}
                        jobs={jobs}
                        onRemove={handleRemove}
                        onSwipe={handleSwipe}
                        canLike={canLike}
                        onMove={isEmployer ? handleMove : undefined}
                        onNote={handleNote}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Shell>
  )
}

function BookmarkCard({
  bookmark: bm,
  role,
  jobs,
  onRemove,
  onSwipe,
  onMove,
  onNote,
  canLike = true,
}: {
  bookmark: EnrichedBookmark
  role: string | null
  jobs: JobPosting[]
  onRemove: (id: string) => void
  onSwipe?: (id: string, dir: 'like' | 'pass') => void
  onMove?: (id: string, jobId: string | null) => void
  canLike?: boolean
  onNote: (id: string, note: string) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteText, setNoteText] = useState(bm.note || '')
  const [showMove, setShowMove] = useState(false)

  const saved = new Date(bm.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const isJob = role === 'worker'

  // Expiry
  const expiresDate = new Date(bm.expires_at)
  const now = new Date()
  const daysLeft = Math.max(0, Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  const expiryColor = daysLeft <= 3 ? 'text-red-500' : daysLeft <= 7 ? 'text-amber-500' : 'text-gray-400'
  const expiryLabel = daysLeft === 0 ? 'Expiring today' : `${daysLeft}d left`

  const title = isJob ? bm.job_title || 'Untitled Job' : bm.name || 'Unknown Worker'
  const subtitle = isJob
    ? bm.company_name || ''
    : bm.experience_years != null ? `${bm.experience_years} years experience` : ''
  const desc = isJob ? bm.description : bm.bio
  const loc = bm.location || ''
  const salary = isJob && (bm.salary_min || bm.salary_max)
    ? `$${((bm.salary_min ?? 0) / 1000).toFixed(0)}k – $${((bm.salary_max ?? 0) / 1000).toFixed(0)}k`
    : null
  const avatarUrl = bm.avatar_url
  const initials = title.charAt(0).toUpperCase()

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{title}</h3>
            {isJob && bm.remote && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-semibold rounded-full flex-shrink-0">
                Remote
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-sm text-gray-500">
            {subtitle && <span>{subtitle}</span>}
            {subtitle && loc && <span>·</span>}
            {loc && <span>{loc}</span>}
            {salary && <span>· {salary}</span>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-xs text-gray-400">Saved {saved}</span>
          <span className={`text-xs font-medium ${expiryColor}`}>{expiryLabel}</span>
        </div>
      </div>

      {/* Description */}
      {desc && <p className="text-sm text-gray-600 mt-3 line-clamp-2">{desc}</p>}

      {/* Tags */}
      {bm.tags && bm.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {bm.tags.slice(0, 8).map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
          {bm.tags.length > 8 && (
            <span className="text-xs text-gray-400 self-center">+{bm.tags.length - 8} more</span>
          )}
        </div>
      )}

      {/* Skills fallback */}
      {!isJob && bm.skills && bm.skills.length > 0 && (!bm.tags || bm.tags.length === 0) && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {bm.skills.map((s) => (
            <span key={s} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{s}</span>
          ))}
        </div>
      )}

      {/* Note */}
      {editingNote ? (
        <div className="mt-3 flex gap-2">
          <input
            autoFocus
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onNote(bm.target_id, noteText)
                setEditingNote(false)
              }
              if (e.key === 'Escape') setEditingNote(false)
            }}
          />
          <button
            onClick={() => { onNote(bm.target_id, noteText); setEditingNote(false) }}
            className="text-xs font-medium text-brand-600 px-2 py-1 rounded-lg hover:bg-brand-50"
          >
            Save
          </button>
        </div>
      ) : bm.note ? (
        <button
          onClick={() => setEditingNote(true)}
          className="mt-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <span className="text-xs">&#9998;</span>
          <span className="italic">{bm.note}</span>
        </button>
      ) : null}

      {/* Move dropdown */}
      {showMove && onMove && (
        <div className="mt-3 bg-gray-50 rounded-xl p-3 space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-2">Move to:</p>
          {jobs.filter((j) => j.active).map((j) => (
            <button
              key={j.id}
              onClick={() => { onMove(bm.target_id, j.id); setShowMove(false) }}
              className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors ${
                bm.job_posting_id === j.id
                  ? 'bg-brand-100 text-brand-700 font-medium'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              {j.title}
            </button>
          ))}
          <button
            onClick={() => { onMove(bm.target_id, null); setShowMove(false) }}
            className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors ${
              !bm.job_posting_id ? 'bg-gray-200 text-gray-700 font-medium' : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            Unsorted
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
        {onSwipe && (
          <button
            onClick={() => onSwipe(bm.target_id, 'pass')}
            className="text-xs font-medium text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1"
          >
            <span className="text-sm">&#10007;</span> Pass
          </button>
        )}
        {onSwipe && canLike && (
          <button
            onClick={() => onSwipe(bm.target_id, 'like')}
            className="text-xs font-medium text-green-500 hover:text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors flex items-center gap-1"
          >
            <span className="text-sm">&#10003;</span> Like
          </button>
        )}
        {onMove && (
          <button
            onClick={() => setShowMove(!showMove)}
            className="text-xs font-medium text-brand-500 hover:text-brand-700 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
          >
            Move
          </button>
        )}
        <button
          onClick={() => { setEditingNote(true); setNoteText(bm.note || '') }}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          {bm.note ? 'Edit note' : 'Add note'}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onRemove(bm.target_id)}
          className="text-xs font-medium text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center">
      {children}
    </div>
  )
}
