// One card shape for both feeds (same idea as the web SwipeCard's CardData).
import type { EmployerCard, MatchScore, Tag, WorkerCard } from '@jobswipe/shared/api'
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
}

const k = (n: number) => `₪${Math.round(n / 1000)}k`

export function jobToCard(e: EmployerCard): CardData {
  const salary =
    e.salary_min && e.salary_max ? `${k(e.salary_min)}–${k(e.salary_max)}`
      : e.salary_min ? i18n.t('swipeCard.fromSalary', { amount: k(e.salary_min) }) : null
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
  }
}
