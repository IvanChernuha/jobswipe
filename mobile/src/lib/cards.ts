// One card shape for both feeds (same idea as the web SwipeCard's CardData).
import type { EmployerCard, Match, MatchScore, SavedItem, Tag, WorkerCard } from '@jobswipe/shared/api'
import i18n from './i18n'

export interface CardData {
  id: string
  kind: 'job' | 'candidate'
  /** Big line: job title, or the candidate's name. */
  headline: string
  /** Company (jobs) or years of experience (candidates). */
  subtitle: string
  /** For the avatar initials: company or candidate name. */
  name: string
  avatarUrl: string | null
  location: string
  salary: string | null
  about: string
  tags: Tag[]
  match: MatchScore | null
  /** The other side already liked / super liked you. */
  liked: 'like' | 'super_like' | null
}

const k = (n: number) => `₪${Math.round(n / 1000)}k`

/** "₪15k–22k", "From ₪15k", or null when the job gives no salary. */
export function salaryRange(min?: number | null, max?: number | null): string | null {
  if (min && max) return `${k(min)}–${k(max)}`
  return min ? i18n.t('swipeCard.fromSalary', { amount: k(min) }) : null
}

export function jobToCard(e: EmployerCard): CardData {
  const salary = salaryRange(e.salary_min, e.salary_max)
  return {
    id: e.id,
    kind: 'job',
    headline: e.job_title,
    subtitle: e.industry ? `${e.company_name} · ${e.industry}` : e.company_name,
    name: e.company_name,
    avatarUrl: e.avatar_url,
    location: e.location,
    salary,
    about: e.description,
    tags: e.tags ?? [],
    match: e.match_score ?? null,
    liked: e.liked_you ?? null,
  }
}

export function candidateToCard(w: WorkerCard): CardData {
  return {
    id: w.id,
    kind: 'candidate',
    headline: w.name,
    subtitle: i18n.t('swipeCard.yearsExperience', { count: w.experience_years ?? 0 }),
    name: w.name,
    avatarUrl: w.avatar_url,
    location: w.location,
    salary: null,
    about: w.bio,
    tags: w.tags ?? [],
    match: w.match_score ?? null,
    liked: w.liked_you ?? null,
  }
}

/** A saved item (GET /bookmarks) as a card: a job for workers, a candidate for employers. */
export function savedToCard(b: SavedItem, employer: boolean): CardData {
  if (employer) {
    const name = b.name ?? ''
    return {
      id: b.target_id, kind: 'candidate', headline: name,
      subtitle: i18n.t('swipeCard.yearsExperience', { count: b.experience_years ?? 0 }),
      name, avatarUrl: b.avatar_url ?? null, location: b.location ?? '', salary: null,
      about: b.bio ?? '', tags: b.tags ?? [], match: null, liked: null,
    }
  }
  const company = b.company_name ?? ''
  return {
    id: b.target_id, kind: 'job', headline: b.job_title ?? '', subtitle: company,
    name: company, avatarUrl: b.avatar_url ?? null,
    location: b.remote ? i18n.t('bookmarks.remote') : b.location ?? '',
    salary: salaryRange(b.salary_min, b.salary_max), about: b.description ?? '',
    tags: b.tags ?? [], match: null, liked: null,
  }
}

/** The other side of a match (GET /matches/{id}) as a card. */
export function matchToCard(m: Match, worker: boolean): CardData {
  if (worker) {
    const e = m.employer
    const company = e?.company_name ?? ''
    return {
      id: m.id, kind: 'job', headline: e?.job_title ?? '',
      subtitle: e?.industry ? `${company} · ${e.industry}` : company,
      name: company, avatarUrl: e?.avatar_url ?? null,
      location: e?.remote ? i18n.t('bookmarks.remote') : e?.location ?? '',
      salary: salaryRange(e?.salary_min, e?.salary_max), about: e?.description ?? '',
      tags: e?.tags ?? [], match: null, liked: null,
    }
  }
  const w = m.worker
  const name = w?.name ?? ''
  return {
    id: m.id, kind: 'candidate', headline: name,
    subtitle: i18n.t('swipeCard.yearsExperience', { count: w?.experience_years ?? 0 }),
    name, avatarUrl: w?.avatar_url ?? null, location: w?.location ?? '', salary: null,
    about: w?.bio ?? '', tags: w?.tags ?? [], match: null, liked: null,
  }
}
