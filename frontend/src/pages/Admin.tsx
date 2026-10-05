import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import {
  amIAdmin, getModerationStatus, getAdminReports, dismissReport, actionReport,
  getSuspendedUsers, unsuspendUser, getHiddenJobs, unhideJob, getLiquidity,
  getPromoCodes, createPromoCode, deactivatePromoCode, getProAccounts, revokeProGrant,
  type ModerationStatus, type AdminReport, type AdminReportStatus, type SuspendedUser,
  type HiddenJob, type Liquidity, type PromoCode, type ProAccount,
} from '../lib/api'
import ColumnChart from '../components/ColumnChart'
import Icon from '../components/Icon'

// Validated pair (teal / amber): passes chroma, CVD and contrast checks on white.
const WORKER_COLOR = '#00908D'
const EMPLOYER_COLOR = '#D07A0A'

type Tab = 'liquidity' | 'moderation' | 'plans'

export default function Admin() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const token = session?.access_token ?? ''
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('liquidity')

  useEffect(() => {
    if (!token) return
    amIAdmin(token).then((r) => setAllowed(r.admin)).catch(() => setAllowed(false))
  }, [token])

  if (allowed === null) return <Shell><Spinner /></Shell>
  if (!allowed) {
    return (
      <Shell>
        <div className="text-center py-20">
          <Icon name="shield" className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-600">{t('admin.notAllowed')}</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('admin.title')}</h1>
        <div className="flex rounded-xl bg-gray-100 p-1" role="tablist">
          {(['liquidity', 'moderation', 'plans'] as Tab[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`min-h-[40px] px-4 rounded-lg text-sm font-medium transition-colors ${
                tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {t(`admin.tab.${k}`)}
            </button>
          ))}
        </div>
      </div>
      {tab === 'liquidity' && <LiquidityTab token={token} />}
      {tab === 'moderation' && <ModerationTab token={token} />}
      {tab === 'plans' && <PlansTab token={token} />}
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------

function LiquidityTab({ token }: { token: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'en'
  const [days, setDays] = useState(30)
  const [includeTest, setIncludeTest] = useState(false)
  const [data, setData] = useState<Liquidity | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    getLiquidity(token, days, includeTest).then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : 'error'))
  }, [token, days, includeTest])

  const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(lang, { month: 'short', day: 'numeric' })
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
  const hours = (h: number | null) => {
    if (h === null) return '—'
    if (h < 1) return t('admin.liq.minutes', { count: Math.max(1, Math.round(h * 60)) })
    if (h < 48) return t('admin.liq.hours', { count: Math.round(h) })
    return t('admin.liq.days', { count: Math.round(h / 24) })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">{t('admin.liq.intro')}</p>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          {t('admin.liq.range')}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"
          >
            {[7, 30, 90].map((d) => <option key={d} value={d}>{t('admin.liq.lastDays', { count: d })}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[40px]">
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          {t('admin.liq.includeTest')}
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data ? <Spinner /> : (
        <>
          <Section title={t('admin.liq.supply')} hint={t('admin.liq.supplyHint')}>
            <Tile label={t('admin.liq.workers')} value={data.totals.workers.toLocaleString()} />
            <Tile label={t('admin.liq.employers')} value={data.totals.employers.toLocaleString()} />
            <Tile
              label={t('admin.liq.employersLive')}
              value={data.totals.employers_with_live_jobs.toLocaleString()}
              sub={t('admin.liq.liveJobs', { count: data.totals.live_jobs })}
            />
            <Tile label={t('admin.liq.newUsers', { count: days })} value={data.totals.new_users.toLocaleString()} />
          </Section>

          <Section title={t('admin.liq.activation')} hint={t('admin.liq.activationHint')}>
            <Tile
              label={t('admin.liq.matched7d')}
              value={pct(data.activation.pct_matched_within_7d)}
              sub={t('admin.liq.xOfY', { x: data.activation.matched_within_7d, y: data.activation.new_users })}
            />
            <Tile label={t('admin.liq.timeToMatch')} value={hours(data.activation.median_hours_to_first_match)} sub={t('admin.liq.median')} />
          </Section>

          <Section title={t('admin.liq.conversations')} hint={t('admin.liq.conversationsHint')}>
            <Tile
              label={t('admin.liq.firstMessage')}
              value={pct(data.conversations.pct_with_first_message)}
              sub={t('admin.liq.xOfY', { x: data.conversations.with_first_message, y: data.conversations.matches })}
            />
            <Tile
              label={t('admin.liq.twoWay')}
              value={pct(data.conversations.pct_two_way)}
              sub={t('admin.liq.xOfY', { x: data.conversations.two_way, y: data.conversations.matches })}
            />
          </Section>

          <ChartCard
            title={t('admin.liq.signupsChart')}
            legend={[{ name: t('admin.liq.workers'), color: WORKER_COLOR }, { name: t('admin.liq.employers'), color: EMPLOYER_COLOR }]}
            table={
              <DataTable
                head={[t('admin.liq.day'), t('admin.liq.workers'), t('admin.liq.employers')]}
                rows={data.daily.map((d) => [fmtDay(d.day), d.workers, d.employers])}
              />
            }
          >
            <ColumnChart
              ariaLabel={t('admin.liq.signupsChart')}
              totalLabel={t('admin.liq.total')}
              series={[{ name: t('admin.liq.workers'), color: WORKER_COLOR }, { name: t('admin.liq.employers'), color: EMPLOYER_COLOR }]}
              data={data.daily.map((d) => ({ label: fmtDay(d.day), values: [d.workers, d.employers] }))}
            />
          </ChartCard>

          <ChartCard
            title={t('admin.liq.matchesChart')}
            table={
              <DataTable
                head={[t('admin.liq.day'), t('admin.liq.matches')]}
                rows={data.daily.map((d) => [fmtDay(d.day), d.matches])}
              />
            }
          >
            <ColumnChart
              ariaLabel={t('admin.liq.matchesChart')}
              series={[{ name: t('admin.liq.matches'), color: WORKER_COLOR }]}
              data={data.daily.map((d) => ({ label: fmtDay(d.day), values: [d.matches] }))}
            />
          </ChartCard>
        </>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-500 mb-3">{hint}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
    </section>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="font-display text-3xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function ChartCard({
  title, legend, table, children,
}: { title: string; legend?: { name: string; color: string }[]; table: ReactNode; children: ReactNode }) {
  const { t } = useTranslation()
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <div className="flex items-center gap-4">
          {legend && legend.map((l) => (
            <span key={l.name} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
          <button onClick={() => setShowTable(!showTable)} className="text-xs font-medium text-brand-600 hover:text-brand-700 min-h-[32px]">
            {showTable ? t('admin.liq.showChart') : t('admin.liq.showTable')}
          </button>
        </div>
      </div>
      {showTable ? table : children}
    </section>
  )
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr>{head.map((h) => <th key={h} className="text-start font-medium text-gray-500 py-1.5 border-b border-gray-200">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100">
              {r.map((c, j) => <td key={j} className={`py-1.5 ${j > 0 ? 'tabular-nums' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

function ModerationTab({ token }: { token: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'en'
  const [status, setStatus] = useState<ModerationStatus | null>(null)
  const [filter, setFilter] = useState<AdminReportStatus>('pending')
  const [reports, setReports] = useState<AdminReport[] | null>(null)
  const [suspended, setSuspended] = useState<SuspendedUser[]>([])
  const [hidden, setHidden] = useState<HiddenJob[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    getModerationStatus(token).then(setStatus).catch(() => {})
    getSuspendedUsers(token).then(setSuspended).catch(() => {})
    getHiddenJobs(token).then(setHidden).catch(() => {})
    getAdminReports(token, filter).then(setReports).catch(() => setReports([]))
  }, [token, filter])

  useEffect(() => { setReports(null); reload() }, [reload])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error')
    }
    setBusy(null)
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang, { month: 'short', day: 'numeric' }) : '')

  return (
    <div className="space-y-8">
      {status && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label={t('admin.mod.pending')} value={String(status.pending_reports)} />
          <Tile label={t('admin.mod.suspended')} value={String(status.suspended_users)} />
          <Tile label={t('admin.mod.hidden')} value={String(status.hidden_jobs)} />
          <Tile
            label={t('admin.mod.autoActions')}
            value={status.auto_actions ? t('admin.mod.on') : t('admin.mod.off')}
            sub={t('admin.mod.threshold', { count: status.threshold })}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-900">{t('admin.mod.reports')}</h2>
          <div className="flex rounded-xl bg-gray-100 p-1">
            {(['pending', 'actioned', 'dismissed'] as AdminReportStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                aria-pressed={filter === s}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-medium ${filter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                {t(`admin.mod.status.${s}`)}
              </button>
            ))}
          </div>
        </div>

        {reports === null ? <Spinner /> : reports.length === 0 ? (
          <Empty text={t('admin.mod.noReports')} />
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        r.reason === 'harassment' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'
                      }`}>{t(`report.reasons.${r.reason}`)}</span>
                      <span className="text-xs text-gray-500">{t(`admin.mod.type.${r.target_type}`)}</span>
                      {r.target_reports > 1 && (
                        <span className="text-xs font-medium text-amber-700">{t('admin.mod.reportCount', { count: r.target_reports })}</span>
                      )}
                    </div>
                    <p dir="auto" className="font-semibold text-gray-900 break-words">{r.target_label}</p>
                    {r.target_detail && <p className="text-xs text-gray-500 break-all">{r.target_detail}</p>}
                    {r.details && <p dir="auto" className="text-sm text-gray-700 mt-2 whitespace-pre-line">{r.details}</p>}
                    <p className="text-xs text-gray-400 mt-2 break-all">
                      {t('admin.mod.reportedBy', { email: r.reporter_email || '—' })}{r.created_at ? ` · ${fmt(r.created_at)}` : ''}
                    </p>
                  </div>
                  {r.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={busy === r.id}
                        onClick={() => run(r.id, () => dismissReport(token, r.id))}
                        className="btn-secondary text-sm min-h-[44px] px-4"
                      >
                        {t('admin.mod.dismiss')}
                      </button>
                      <button
                        disabled={busy === r.id}
                        onClick={() => {
                          const msg = r.target_type === 'job' ? t('admin.mod.confirmHide') : t('admin.mod.confirmSuspend')
                          if (confirm(msg)) run(r.id, () => actionReport(token, r.id))
                        }}
                        className="btn text-sm min-h-[44px] px-4 bg-red-600 text-white hover:bg-red-700"
                      >
                        {r.target_type === 'job' ? t('admin.mod.hideJob') : t('admin.mod.suspendUser')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('admin.mod.suspendedUsers')}</h2>
        {suspended.length === 0 ? <Empty text={t('admin.mod.noSuspended')} /> : (
          <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {suspended.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-all">{u.email}</p>
                  <p className="text-xs text-gray-500">{t(`register.${u.role}`)} · {fmt(u.suspended_at)}{u.reason ? ` · ${u.reason}` : ''}</p>
                </div>
                <button disabled={busy === u.id} onClick={() => run(u.id, () => unsuspendUser(token, u.id))} className="btn-secondary text-sm min-h-[44px] px-4">
                  {t('admin.mod.unsuspend')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('admin.mod.hiddenJobs')}</h2>
        {hidden.length === 0 ? <Empty text={t('admin.mod.noHidden')} /> : (
          <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {hidden.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p dir="auto" className="font-medium text-gray-900 break-words">{j.title}</p>
                  <p className="text-xs text-gray-500 break-all">{j.employer_email}{j.note ? ` · ${j.note}` : ''}</p>
                </div>
                <button disabled={busy === j.id} onClick={() => run(j.id, () => unhideJob(token, j.id))} className="btn-secondary text-sm min-h-[44px] px-4">
                  {t('admin.mod.unhide')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plans: promo codes
// ---------------------------------------------------------------------------

const DURATIONS: { days: number | null; key: string }[] = [
  { days: 30, key: 'd30' }, { days: 90, key: 'd90' }, { days: 180, key: 'd180' },
  { days: 365, key: 'd365' }, { days: null, key: 'forever' },
]

function PlansTab({ token }: { token: string }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'en'
  const [codes, setCodes] = useState<PromoCode[] | null>(null)
  const [accounts, setAccounts] = useState<ProAccount[]>([])
  const [code, setCode] = useState('')
  const [duration, setDuration] = useState<string>('90')
  const [maxUses, setMaxUses] = useState('20')
  const [redeemByDays, setRedeemByDays] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [freeLimit, setFreeLimit] = useState<number | null>(null)
  useEffect(() => { getModerationStatus(token).then((s) => setFreeLimit(s.free_live_jobs)).catch(() => {}) }, [token])

  const reload = useCallback(() => {
    getPromoCodes(token).then(setCodes).catch(() => setCodes([]))
    getProAccounts(token).then(setAccounts).catch(() => {})
  }, [token])
  useEffect(() => { reload() }, [reload])

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  const durationLabel = (d: number | null) => t(`admin.plans.dur.${DURATIONS.find((x) => x.days === d)?.key ?? 'custom'}`, { count: d ?? 0 })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setCreated(null)
    try {
      const c = await createPromoCode(token, {
        code: code.trim(),
        duration_days: duration === 'forever' ? null : Number(duration),
        max_uses: Math.max(1, Number(maxUses) || 1),
        redeem_by_days: redeemByDays ? Number(redeemByDays) : null,
        note: note.trim(),
      })
      setCreated(c.code); setCode(''); setNote('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error')
    }
    setBusy(false)
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">{freeLimit !== null && t('admin.plans.intro', { limit: freeLimit })}</p>

      <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.plans.newCode')}</h2>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pc-code" className="label">{t('admin.plans.code')}</label>
            <input id="pc-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('admin.plans.codePlaceholder')} className="input uppercase placeholder:normal-case" />
          </div>
          <div>
            <label htmlFor="pc-dur" className="label">{t('admin.plans.duration')}</label>
            <select id="pc-dur" value={duration} onChange={(e) => setDuration(e.target.value)} className="input">
              {DURATIONS.map((d) => <option key={d.key} value={d.days ?? 'forever'}>{t(`admin.plans.dur.${d.key}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pc-uses" className="label">{t('admin.plans.maxUses')}</label>
            <input id="pc-uses" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className="input" />
            <p className="text-xs text-gray-500 mt-1">{t('admin.plans.maxUsesHint')}</p>
          </div>
          <div>
            <label htmlFor="pc-by" className="label">{t('admin.plans.redeemBy')}</label>
            <input id="pc-by" type="number" min={1} value={redeemByDays} onChange={(e) => setRedeemByDays(e.target.value)} placeholder={t('admin.plans.redeemByPlaceholder')} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="pc-note" className="label">{t('admin.plans.note')}</label>
            <input id="pc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('admin.plans.notePlaceholder')} className="input" />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="btn-primary text-sm px-5 min-h-[44px]">{t('admin.plans.create')}</button>
            {created && (
              <span className="text-sm text-brand-800" role="status">
                {t('admin.plans.created')} <strong dir="ltr" className="font-mono">{created}</strong>
              </span>
            )}
            {error && <span className="text-sm text-red-600" role="alert">{error}</span>}
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('admin.plans.codes')}</h2>
        {codes === null ? <Spinner /> : codes.length === 0 ? <Empty text={t('admin.plans.noCodes')} /> : (
          <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {codes.map((c) => {
              const expired = !!c.redeem_by && new Date(c.redeem_by) < new Date()
              const full = c.uses >= c.max_uses
              const state = !c.active ? 'off' : expired ? 'expired' : full ? 'full' : 'live'
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => copy(c.code)} dir="ltr" className="font-mono font-semibold text-gray-900 hover:text-brand-600" title={t('admin.plans.copy')}>
                        {c.code}
                      </button>
                      {copied === c.code && <span className="text-xs text-brand-700">{t('admin.plans.copied')}</span>}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        state === 'live' ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-600'
                      }`}>{t(`admin.plans.state.${state}`)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {durationLabel(c.duration_days)} · {t('admin.plans.uses', { used: c.uses, max: c.max_uses })}
                      {c.redeem_by ? ` · ${t('admin.plans.redeemUntil', { date: fmt(c.redeem_by) })}` : ''}
                      {c.note ? ` · ${c.note}` : ''}
                    </p>
                  </div>
                  {c.active && (
                    <button
                      onClick={async () => { if (confirm(t('admin.plans.confirmDeactivate'))) { await deactivatePromoCode(token, c.id).catch(() => {}); reload() } }}
                      className="btn-secondary text-sm min-h-[44px] px-4"
                    >
                      {t('admin.plans.deactivate')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{t('admin.plans.proAccounts')}</h2>
        {accounts.length === 0 ? <Empty text={t('admin.plans.noPro')} /> : (
          <ul className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p dir="auto" className="font-medium text-gray-900 break-all">{a.account}</p>
                  <p className="text-xs text-gray-500 break-all">
                    {a.ends_at ? t('admin.plans.proUntil', { date: fmt(a.ends_at) }) : t('plan.forever')}
                    {a.code ? ` · ${a.code}` : ''}
                    {a.redeemed_by && a.redeemed_by !== a.account ? ` · ${a.redeemed_by}` : ''}
                  </p>
                </div>
                <button
                  onClick={async () => { if (confirm(t('admin.plans.confirmRevoke'))) { await revokeProGrant(token, a.id).catch(() => {}); reload() } }}
                  className="btn-secondary text-sm min-h-[44px] px-4"
                >
                  {t('admin.plans.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center">{text}</p>
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">{children}</div>
}
