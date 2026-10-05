import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { redeemCode, type PlanSummary } from '../lib/api'
import Icon from './Icon'

export function planUntilLabel(t: (k: string, o?: Record<string, unknown>) => string, plan: PlanSummary, lang: string): string {
  if (plan.plan !== 'pro') return ''
  if (!plan.pro_until) return t('plan.forever')
  return t('plan.until', { date: new Date(plan.pro_until).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) })
}

/** Code input. Calls onRedeemed with the new plan on success. */
export function RedeemForm({ token, onRedeemed }: { token: string; onRedeemed: (p: PlanSummary) => void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    try {
      onRedeemed(await redeemCode(token, code))
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plan.redeemFailed'))
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="promo-code" className="label">{t('plan.haveCode')}</label>
      <div className="flex gap-2">
        <input
          id="promo-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TELAVIV50"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          className="input uppercase tracking-wider font-medium"
        />
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary text-sm px-5 shrink-0">
          {busy ? '…' : t('plan.redeem')}
        </button>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </form>
  )
}

/** Profile card for employers: current plan, usage, and code redemption. */
export default function PlanCard({
  token, plan, onChange,
}: { token: string; plan: PlanSummary; onChange: (p: PlanSummary) => void }) {
  const { t, i18n } = useTranslation()
  const isPro = plan.plan === 'pro'
  const [justRedeemed, setJustRedeemed] = useState(false)

  return (
    <div className="mt-8 bg-white rounded-3xl shadow-xl shadow-gray-100 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-900">{t('plan.title')}</h2>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${
          isPro ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700'
        }`}>
          {isPro && <Icon name="sparkles" className="w-4 h-4" />}
          {isPro ? t('plan.pro') : t('plan.free')}
        </span>
      </div>

      {justRedeemed && (
        <p className="mb-4 rounded-xl bg-brand-50 text-brand-800 px-4 py-3 text-sm" role="status">{t('plan.redeemedOk')}</p>
      )}

      <dl className="space-y-2 text-sm mb-5">
        {isPro && (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">{t('plan.validity')}</dt>
            <dd className="font-medium text-gray-900">{planUntilLabel(t, plan, i18n.resolvedLanguage ?? 'en')}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">{t('plan.liveJobs')}</dt>
          <dd className="font-medium text-gray-900 tabular-nums">
            {isPro ? t('plan.liveJobsUnlimited', { count: plan.live_jobs }) : t('plan.liveJobsOf', { used: plan.live_jobs, limit: plan.free_live_jobs })}
          </dd>
        </div>
        {plan.shared_with_team && <p className="text-xs text-gray-500">{t('plan.sharedWithTeam')}</p>}
      </dl>

      {!isPro && <p className="text-sm text-gray-600 mb-4">{t('plan.proPitch')}</p>}

      {plan.can_redeem ? (
        <RedeemForm token={token} onRedeemed={(p) => { setJustRedeemed(true); onChange(p) }} />
      ) : (
        <p className="text-sm text-gray-500">{t('plan.askOwner')}</p>
      )}
    </div>
  )
}
