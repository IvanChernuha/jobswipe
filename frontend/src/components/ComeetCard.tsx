import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  connectComeet, disconnectComeet, getComeetStatus, syncComeet, type ComeetStatus,
} from '../lib/api'

const SETTINGS_URL = 'https://app.comeet.co/app/company/settings/careers'

/**
 * Jobs page: import jobs from Comeet (OpenProject #3297). One paste of the
 * company's UID + Token; the server imports every published job in the
 * background and keeps them in sync. Polls while an import runs.
 */
export default function ComeetCard({ token, onJobsChanged, needCheck = 0, pollMs = 3000 }: {
  token: string
  onJobsChanged: () => void
  /** Imported jobs held off by the job check (missing something). */
  needCheck?: number
  pollMs?: number
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ComeetStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ company: string; count: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changed = useRef(onJobsChanged)
  changed.current = onJobsChanged

  const load = useCallback(async () => {
    try {
      const next = await getComeetStatus(token)
      setStatus(next)
      return next
    } catch {
      return null
    }
  }, [token])

  // While importing: check again shortly; when it finishes, refresh the job list.
  const watch = useCallback((next: ComeetStatus | null) => {
    if (timer.current) clearTimeout(timer.current)
    if (next?.status !== 'importing') return
    timer.current = setTimeout(async () => {
      const after = await load()
      if (after && after.status !== 'importing') {
        setFound(null)
        changed.current()
      }
      watch(after)
    }, pollMs)
  }, [load, pollMs])

  useEffect(() => {
    load().then(watch)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [load, watch])

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res = await connectComeet(token, paste)
      setFound({ company: res.company_name, count: res.found })
      setOpen(false)
      setPaste('')
      const next: ComeetStatus = { ...(status ?? {}), connected: true, company_name: res.company_name, status: 'importing' }
      setStatus(next)
      watch(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setError(null)
    try {
      await syncComeet(token)
      const next: ComeetStatus = { ...(status ?? { connected: true }), status: 'importing' }
      setStatus(next)
      watch(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function disconnect() {
    if (!window.confirm(t('comeet.disconnectConfirm'))) return
    try {
      await disconnectComeet(token)
      setStatus({ connected: false })
      changed.current()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!status) return null

  const box = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-3'
  const small = 'text-sm font-medium px-4 py-2 rounded-xl border min-h-[40px] disabled:opacity-50'

  if (!status.connected) {
    return (
      <section className={box}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">{t('comeet.title')}</h2>
            <p className="text-sm text-gray-600">{t('comeet.pitch')}</p>
          </div>
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className="btn-primary min-h-[44px] px-5">
              {t('comeet.start')}
            </button>
          )}
        </div>
        {open && (
          <div className="space-y-3">
            <ol className="list-decimal ps-5 space-y-1 text-sm text-gray-700">
              <li>{t('comeet.step1')}</li>
              <li>{t('comeet.step2')}</li>
              <li>{t('comeet.step3')}</li>
            </ol>
            <a href={SETTINGS_URL} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-brand-700 underline">
              {t('comeet.openSettings')}
            </a>
            <div>
              <label htmlFor="comeet-paste" className="block text-sm font-medium text-gray-700 mb-1">{t('comeet.pasteLabel')}</label>
              <textarea
                id="comeet-paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)}
                placeholder={t('comeet.pastePlaceholder')} className="input w-full font-mono text-sm" dir="ltr"
                autoComplete="off" spellCheck={false}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={connect} disabled={!paste.trim() || busy} className="btn-primary min-h-[44px] px-5 disabled:opacity-50">
                {t('comeet.connect')}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(null) }} className={`${small} border-gray-200 text-gray-600`}>
                {t('comeet.cancel')}
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  const importing = status.status === 'importing'
  return (
    <section className={box} aria-busy={importing}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {importing ? (
            <p className="flex items-center gap-2 text-gray-800">
              <span className="w-4 h-4 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" aria-hidden />
              {found ? t('comeet.found', { count: found.count, company: found.company }) : t('comeet.importing')}
            </p>
          ) : (
            <>
              <p className="font-semibold text-gray-900">
                {t('comeet.connected', { count: status.live_count ?? 0, company: status.company_name })}
              </p>
              {status.last_synced_at && (
                <p className="text-sm text-gray-500">
                  {t('comeet.lastSynced', { time: new Date(status.last_synced_at).toLocaleString() })}
                </p>
              )}
            </>
          )}
          {status.status === 'error' && status.last_error && (
            <p className="text-sm text-red-600">{t('comeet.error', { error: status.last_error })}</p>
          )}
          {!importing && needCheck > 0 && (
            <p className="text-sm text-red-700">{t('jobCheck.comeetNeedCheck', { count: needCheck })}</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        {!importing && (
          <div className="flex gap-2">
            <button type="button" onClick={syncNow} className={`${small} border-brand-200 text-brand-700 hover:bg-brand-50`}>
              {t('comeet.syncNow')}
            </button>
            <button type="button" onClick={disconnect} className={`${small} border-gray-200 text-gray-600 hover:bg-gray-50`}>
              {t('comeet.disconnect')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
