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
}

export function workerToCard(w: WorkerCard): CardData {
  return {
    id: w.id,
    name: w.name,
    avatar_url: w.avatar_url,
    title: `${w.experience_years} yr${w.experience_years !== 1 ? 's' : ''} experience`,
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
        ? `From $${(e.salary_min / 1000).toFixed(0)}k`
        : null

  return {
    id: e.id,
    name: e.company_name,
    avatar_url: e.avatar_url,
    title: e.job_title,
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

type OverlayDir = 'like' | 'pass' | null

function Overlay({ dir }: { dir: OverlayDir }) {
  if (!dir) return null
  const isLike = dir === 'like'
  return (
    <div
      className={`absolute inset-0 rounded-3xl flex items-start justify-end p-6 transition-opacity z-10
        ${isLike ? 'bg-green-400/20' : 'bg-red-400/20'}`}
    >
      <span
        className={`text-4xl font-black rotate-12 border-4 px-3 py-1 rounded-lg
          ${isLike ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}`}
      >
        {isLike ? 'LIKE' : 'NOPE'}
      </span>
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
  const pct = score.percentage
  // Color: green ≥70%, yellow ≥40%, gray <40%
  const color =
    pct >= 70
      ? 'bg-green-500/90 text-white'
      : pct >= 40
        ? 'bg-yellow-500/90 text-white'
        : 'bg-gray-600/80 text-white'

  return (
    <div className={`absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-sm shadow-lg ${color}`}>
      <span className="text-sm font-bold">{pct}%</span>
      <span className="text-xs opacity-90">match</span>
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
}

export default function SwipeCard({ card, overlayDir = null, animClass }: SwipeCardProps) {
  // Prefer tags over legacy skills array
  const hasTags = card.tags.length > 0

  return (
    <div
      className={`relative w-full max-w-sm bg-white rounded-3xl overflow-hidden card-shadow
                  select-none ${animClass ?? ''}`}
    >
      <Overlay dir={overlayDir} />

      {/* Photo / gradient header */}
      <div className="relative h-64 bg-gradient-to-br from-brand-400 to-purple-500 overflow-hidden">
        <Avatar url={card.avatar_url} name={card.name} />

        {/* Bottom fade for text legibility */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />

        {/* Match score badge */}
        {card.match_score && card.match_score.total > 0 && (
          <MatchBadge score={card.match_score} />
        )}

        {/* Name + title overlay */}
        <div className="absolute bottom-4 left-5 right-5">
          <p className="text-white text-xl font-bold leading-tight drop-shadow">{card.name}</p>
          <p className="text-white/80 text-sm mt-0.5">{card.title}</p>
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

        {/* Bio */}
        <p className="text-sm text-gray-600 line-clamp-3 leading-relaxed">{card.bio}</p>

        {/* Tags (color-coded) or legacy skills fallback */}
        {hasTags ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {card.tags.slice(0, 6).map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
            {card.tags.length > 6 && (
              <span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                +{card.tags.length - 6} more
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
                +{card.skills.length - 6} more
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
