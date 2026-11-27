import { useTranslation } from 'react-i18next'
import type { JobIssue } from '@jobswipe/shared/jobs'

/**
 * The job check (user 2026-11-26): what a job still needs before it can go
 * live (red) and tips (amber), or "Ready to go live". `compact` shows only
 * what's missing, for cards and the job list.
 */
export default function JobChecklist({ issues, compact = false }: {
  issues: Pick<JobIssue, 'code' | 'level'>[] | { code: string; level: string }[]
  compact?: boolean
}) {
  const { t } = useTranslation()
  const must = issues.filter((i) => i.level === 'must')
  const should = compact ? [] : issues.filter((i) => i.level === 'should')
  if (compact && must.length === 0) return null

  return (
    <div className={`rounded-xl px-3 py-2 text-sm ${must.length ? 'bg-red-50 border border-red-200' : 'bg-brand-50 border border-brand-100'}`}
      role={must.length ? 'status' : undefined}>
      {must.length > 0 ? (
        <>
          <p className="font-medium text-red-700">{t('jobCheck.stillNeeded')}</p>
          <ul className="list-disc ps-5 text-red-700">
            {must.map((i) => <li key={i.code}>{t(`jobCheck.${i.code}`)}</li>)}
          </ul>
        </>
      ) : (
        <p className="font-medium text-brand-700">✓ <span>{t('jobCheck.ready')}</span></p>
      )}
      {should.length > 0 && (
        <>
          <p className="font-medium text-amber-700 mt-1">{t('jobCheck.tips')}</p>
          <ul className="list-disc ps-5 text-amber-700">
            {should.map((i) => <li key={i.code}>{t(`jobCheck.${i.code}`)}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}
