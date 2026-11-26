import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAiUsage, type AiUsage } from '../lib/api'

const usd = (n: number) => `$${n.toFixed(2)}`

/** Admin: this month's AI (Claude) spend against AI_MONTHLY_BUDGET_USD (backend ai_budget.py). */
export default function AiUsageCard({ token }: { token: string }) {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAiUsage(token).then(setUsage).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!usage) return <div className="w-8 h-8 mx-auto border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />

  const off = usage.budget_usd <= 0
  const percent = off ? 100 : Math.min(100, Math.round((usage.spent_usd / usage.budget_usd) * 100))
  const paused = !off && usage.spent_usd >= usage.budget_usd

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-lg">
      <div>
        <h2 className="font-semibold text-gray-900">{t('admin.ai.title', { month: usage.month })}</h2>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {t('admin.ai.spentOf', { spent: usd(usage.spent_usd), budget: usd(usage.budget_usd) })}
        </p>
        <p className="text-sm text-gray-500">{t('admin.ai.calls', { count: usage.calls, model: usage.model })}</p>
      </div>
      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        aria-label={t('admin.ai.budgetUsed')}
        className="h-3 rounded-full bg-gray-100 overflow-hidden"
      >
        <div
          className={`h-full ${percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-brand-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {off && <p className="text-sm text-red-600 font-medium">{t('admin.ai.off')}</p>}
      {paused && <p className="text-sm text-red-600 font-medium">{t('admin.ai.paused')}</p>}
      {Object.keys(usage.by_feature).length > 0 && (
        <dl className="text-sm divide-y divide-gray-100">
          {Object.entries(usage.by_feature).map(([feature, f]) => (
            <div key={feature} className="flex justify-between py-2">
              <dt className="text-gray-700">{t(`admin.ai.feature.${feature}`, { defaultValue: feature })}</dt>
              <dd className="text-gray-900 tabular-nums">{`${f.calls} · ${usd(f.spent_usd)}`}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-gray-500">{t('admin.ai.hint')}</p>
    </div>
  )
}
