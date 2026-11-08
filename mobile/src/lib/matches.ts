import type { Match } from './api'

/** The other side of a match, as the viewer sees it (a worker sees the company). */
export function otherSide(m: Match, worker: boolean, t: (k: string) => string) {
  return worker
    ? { name: m.employer?.company_name ?? t('matches.unknownEmployer'), avatar: m.employer?.avatar_url ?? null }
    : { name: m.worker?.name ?? t('matches.unknownWorker'), avatar: m.worker?.avatar_url ?? null }
}
