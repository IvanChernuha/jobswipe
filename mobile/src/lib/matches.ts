import type { Match } from './api'

/** The other side of a match, as the viewer sees it (a worker sees the company). */
export function otherSide(m: Match, worker: boolean, t: (k: string) => string) {
  return worker
    ? { name: m.employer?.company_name ?? t('matches.unknownEmployer'), avatar: m.employer?.avatar_url ?? null }
    : { name: m.worker?.name ?? t('matches.unknownWorker'), avatar: m.worker?.avatar_url ?? null }
}

export interface JobGroup {
  /** The job's id, or 'none' for matches without a (still existing) job. */
  key: string
  title: string | null
  matches: Match[]
}

/** An employer's matches under the job each came from, in the order of their
 *  jobs; matches with no job (or a deleted one) go last. */
export function groupByJob(matches: Match[], jobs: { id: string; title: string }[]): JobGroup[] {
  const groups = jobs.map((j) => ({ key: j.id, title: j.title, matches: [] as Match[] }))
  const byId = new Map(groups.map((g) => [g.key, g]))
  const other: JobGroup = { key: 'none', title: null, matches: [] }
  for (const m of matches) (byId.get(m.job_posting_id ?? '') ?? other).matches.push(m)
  return [...groups, other].filter((g) => g.matches.length > 0)
}
