import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import type { WorkerCard, EmployerCard, Tag, MatchScore } from '../lib/api'
import TagBadge from './TagBadge'

// ---------------------------------------------------------------------------
// Unified card data shape (either worker or employer card)
// ---------------------------------------------------------------------------

export interface CardData {
  id: string
  name: string          // worker name OR company name
  avatar_url: string | null
  title: string         // job title OR industry
  bio: string           // bio OR description
  location: string
  skills: string[]      // worker skills OR required skills (legacy fallback)
  tags: Tag[]           // structured tags
  salary?: string | null
  experience_years?: number
  match_score?: MatchScore | null
  /** Job cards: the job title (shown big); `name` stays the company for avatars/match copy. */
  headline?: string
}

export function workerToCard(w: WorkerCard): CardData {
  return {
    id: w.id,
    name: w.name,
    avatar_url: w.avatar_url,
    title: i18n.t('swipeCard.yearsExperience', { count: w.experience_years }),
    bio: w.bio,
    location: w.location,
    skills: w.skills ?? [],
    tags: w.tags ?? [],
    match_score: w.match_score,
  }
}

export function employerToCard(e: EmployerCard): CardData {
  const salary =
    e.salary_min && e.salary_max
      ? `$${(e.salary_min / 1000).toFixed(0)}k\u2013$${(e.salary_max / 1000).toFixed(0)}k`
      : e.salary_min
        ? i18n.t('swipeCard.fromSalary', { amount: `$${(e.salary_min / 1000).toFixed(0)}k` })
        : null

  return {
    id: e.id,
    name: e.company_name,
    avatar_url: e.avatar_url,
    headline: e.job_title,
    title: e.industry ? `${e.company_name} · ${e.industry}` : e.company_name,
    bio: e.description,
    location: e.location,
    skills: e.skills_required ?? [],
    tags: e.tags ?? [],
    salary,
    match_score: e.match_score,
  }
}

// ---------------------------------------------------------------------------
// Overlay helper
// ---------------------------------------------------------------------------

type OverlayDir = 'like' | 'pass' | 'super' | null

function Overlay({ dir }: { dir: OverlayDir }) {
  const { t } = useTranslation()
  if (!dir) return null
  const isLike = dir === 'like' || dir === 'super'
  const label = dir === 'super' ? t('swipeCard.superLike') : dir === 'like' ? t('swipeCard.like') : t('swipeCard.nope')
  const tone = dir === 'super'
    ? '-rotate-12 text-blue-500 border-blue-500'
    : isLike ? '-rotate-12 text-green-500 border-green-500' : 'rotate-12 text-red-500 border-red-500'
  return (
    <div
      className={`absolute inset-0 rounded-3xl transition-opacity z-10
        ${dir === 'super' ? 'bg-blue-400/20' : isLike ? 'bg-green-400/20' : 'bg-red-400/20'}`}
    >
      {/* Physical positions on purpose (not start/end): swipe direction is the
          same in RTL — right = like — so LIKE/SUPER sit top-LEFT and NOPE
          top-RIGHT regardless of text direction, staying on-screen mid-drag. */}
      <span className={`absolute top-6 ${isLike ? 'left-6' : 'right-6'} text-4xl font-black border-4 px-3 py-1 rounded-lg ${tone}`}>{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="w-full h-full object-cover"
      />
    )
  }
  // Initials fallback
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand-300 to-brand-500">
      <span className="text-5xl font-bold text-white">{initials}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Match score badge
// ---------------------------------------------------------------------------

function MatchBadge({ score }: { score: MatchScore }) {
  const { t } = useTranslation()
  const pct = score.percentage
  // Color: green ≥70%, yellow ≥40%, gray <40%
  const color =
    pct >= 70
      ? 'bg-green-500/90 text-white'
      : pct >= 40
        ? 'bg-yellow-500/90 text-white'
        : 'bg-gray-600/80 text-white'

  return (
    <div className={`absolute top-3 start-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-sm shadow-lg ${color}`}>
      <span className="text-sm font-bold">{pct}%</span>
      <span className="text-xs opacity-90">{t('swipeCard.match')}</span>
      <span className="text-[10px] opacity-75">({score.matched}/{score.total})</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SwipeCardProps {
  card: CardData
  overlayDir?: OverlayDir
  animClass?: string
  /** Enables drag-to-swipe (touch + mouse). Called once a drag crosses the commit threshold. */
  onSwipe?: (dir: 'like' | 'pass') => void
}

const SWIPE_COMMIT_PX = 96   // drag distance that commits a like/pass
const SWIPE_OVERLAY_PX = 32  // drag distance before LIKE/NOPE shows

export default function SwipeCard({ card, overlayDir = null, animClass, onSwipe }: SwipeCardProps) {
  const { t } = useTranslation()
  // Prefer tags over legacy skills array
  const hasTags = card.tags.length > 0

  // Long bios are clamped; a tap toggles the full text (a tap never moves far
  // enough to count as a swipe).
  const [expanded, setExpanded] = useState(false)

  // Drag state. Only the top card gets onSwipe, so only it is draggable.
  const dragStart = useRef<{ x: number; y: number; id: number; captured: boolean } | null>(null)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const DEAD_ZONE_PX = 6

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!onSwipe || e.button !== 0) return
    dragStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId, captured: false }
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    if (!start || e.pointerId !== start.id) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    // Capture the pointer only once this is clearly a drag. Capturing on
    // pointerdown would redirect plain clicks to the card and break the
    // tap-to-expand bio (and any other click inside the card).
    if (!start.captured) {
      if (Math.abs(dx) < DEAD_ZONE_PX && Math.abs(dy) < DEAD_ZONE_PX) return
      start.captured = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDrag({ dx, dy })
  }
  function handlePointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || e.pointerId !== dragStart.current.id) return
    const dx = e.clientX - dragStart.current.x
    dragStart.current = null
    setDrag(null)
    if (Math.abs(dx) >= SWIPE_COMMIT_PX) onSwipe?.(dx > 0 ? 'like' : 'pass')
  }
  // The browser cancels the pointer when it claims the gesture as a vertical
  // scroll (touch-pan-y). Never commit on cancel — clientX is meaningless then.
  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || e.pointerId !== dragStart.current.id) return
    dragStart.current = null
    setDrag(null)
  }

  const dragDir: OverlayDir =
    drag && Math.abs(drag.dx) >= SWIPE_OVERLAY_PX ? (drag.dx > 0 ? 'like' : 'pass') : null
  const dragStyle: React.CSSProperties = drag
    ? { transform: `translate(${drag.dx}px, ${drag.dy * 0.3}px) rotate(${drag.dx / 18}deg)`, transition: 'none' }
    : { transition: 'transform 200ms ease' }

  return (
    <div
      className={`relative w-full max-w-sm bg-white rounded-3xl overflow-hidden card-shadow
                  select-none touch-pan-y ${onSwipe ? 'cursor-grab active:cursor-grabbing' : ''} ${animClass ?? ''}`}
      style={dragStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
    >
      <Overlay dir={overlayDir ?? dragDir} />

      {/* Photo / gradient header */}
      <div className="relative h-64 bg-gradient-to-br from-brand-400 to-purple-500 overflow-hidden">
        <Avatar url={card.avatar_url} name={card.name} />

        {/* Bottom fade for text legibility */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />

        {/* Match score badge */}
        {card.match_score && card.match_score.total > 0 && (
          <MatchBadge score={card.match_score} />
        )}

        {/* Kind badge: makes a job card read as a job at a glance */}
        <span className="absolute top-3 end-3 z-10 px-2 py-0.5 rounded-full bg-black/40 text-white text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm">
          {card.headline ? t('swipeCard.job') : t('swipeCard.candidate')}
        </span>

        {/* Headline (job title) or name, then the secondary line */}
        <div className="absolute bottom-4 start-5 end-5">
          <p dir="auto" className="text-white text-xl font-bold leading-tight drop-shadow">{card.headline ?? card.name}</p>
          <p dir="auto" className="text-white/80 text-sm mt-0.5">{card.title}</p>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-3">
        {/* Location */}
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {card.location}
          {card.salary && (
            <>
              <span className="mx-1 text-gray-300">&middot;</span>
              <span className="text-green-600 font-medium">{card.salary}</span>
            </>
          )}
        </div>

        {/* Bio — tap to expand */}
        {card.bio ? (
          <p
            dir="auto"
            className={`text-sm text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {card.bio}
            {!expanded && card.bio.length > 140 && <span className="text-brand-600 font-medium"> {t('swipeCard.moreEllipsis')}</span>}
          </p>
        ) : (
          <p className="text-sm text-gray-400 italic">{t('swipeCard.noDescription')}</p>
        )}

        {/* Tags (color-coded) or legacy skills fallback */}
        {hasTags ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {card.tags.slice(0, 6).map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
            {card.tags.length > 6 && (
              <span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                {t('swipeCard.plusMore', { count: card.tags.length - 6 })}
              </span>
            )}
          </div>
        ) : card.skills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {card.skills.slice(0, 6).map((skill) => (
              <span
                key={skill}
                className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium
                           border border-brand-100"
              >
                {skill}
              </span>
            ))}
            {card.skills.length > 6 && (
              <span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                {t('swipeCard.plusMore', { count: card.skills.length - 6 })}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
