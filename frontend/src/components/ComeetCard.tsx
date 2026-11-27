import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readComeetPaste } from '@jobswipe/shared/comeet'
import {
  connectComeet, disconnectComeet, getComeetStatus, syncComeet, type ComeetStatus,
} from '../lib/api'

const SETTINGS_URL = 'https://app.comeet.co/app/company/settings/careers'
/**
 * The open popup and what was typed, for this tab only: on a phone, opening
 * Comeet backgrounds the tab and the browser may reload it (user 2026-11-27).
 */
const DRAFT = 'jobswipe.comeetDraft'

function readDraft(): { uid: string; token: string } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Jobs page: import jobs from Comeet (OpenProject #3297). A popup with a UID
 * box and a Token box, each with a Paste button (user 2026-11-27); the server
 * imports every published job in the background and keeps them in sync.
 * Polls while an import runs.
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
  const [draft] = useState(readDraft)
  const [open, setOpen] = useState(draft !== null)
  const [uid, setUid] = useState(draft?.uid ?? '')
  const [secret, setSecret] = useState(draft?.token ?? '')
  const [pasteBlocked, setPasteBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ company: string; count: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changed = useRef(onJobsChanged)
  changed.current = onJobsChanged

  useEffect(() => {
    try {
      if (open) sessionStorage.setItem(DRAFT, JSON.stringify({ uid, token: secret }))
      else sessionStorage.removeItem(DRAFT)
    } catch { /* private mode etc.: the popup just won't survive a reload */ }
  }, [open, uid, secret])

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

  /** Sort a paste into the right box(es); unrecognised text goes where it was pasted. */
  function fill(text: string, into: 'uid' | 'token') {
    const found = readComeetPaste(text)
    if (found.uid) setUid(found.uid)
    if (found.token) setSecret(found.token)
    if (!found.uid && !found.token) (into === 'uid' ? setUid : setSecret)(text.trim())
  }

  async function pasteInto(into: 'uid' | 'token') {
    setPasteBlocked(false)
    try {
      fill(await navigator.clipboard.readText(), into)
    } catch {
      setPasteBlocked(true)
    }
  }

  /** Ctrl+V of both values (or of one into the wrong box) still lands right. */
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, into: 'uid' | 'token') {
    const found = readComeetPaste(e.clipboardData.getData('text'))
    const other = into === 'uid' ? found.token : found.uid
    if (!other) return
    e.preventDefault()
    fill(e.clipboardData.getData('text'), into)
  }

  function closeDialog() {
    setOpen(false)
    setUid('')
    setSecret('')
    setError(null)
    setPasteBlocked(false)
  }

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res = await connectComeet(token, `${uid.trim()} ${secret.trim()}`)
      setFound({ company: res.company_name, count: res.found })
      closeDialog()
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
    const ready = uid.trim() !== '' && secret.trim() !== ''
    const field = (id: 'uid' | 'token', value: string, set: (v: string) => void) => (
      <div>
        <label htmlFor={`comeet-${id}`} className="block text-sm font-medium text-gray-700 mb-1">
          {t(id === 'uid' ? 'comeet.uidLabel' : 'comeet.tokenLabel')}
        </label>
        <div className="flex gap-2">
          <input
            id={`comeet-${id}`} autoFocus={id === 'uid'} value={value} onChange={(e) => set(e.target.value)} onPaste={(e) => onPaste(e, id)}
            placeholder={t(id === 'uid' ? 'comeet.uidPlaceholder' : 'comeet.tokenPlaceholder')}
            className="input flex-1 min-w-0 font-mono text-sm" dir="ltr" autoComplete="off" spellCheck={false}
          />
          <button
            type="button" onClick={() => pasteInto(id)} aria-label={t(id === 'uid' ? 'comeet.pasteUid' : 'comeet.pasteToken')}
            className={`${small} border-brand-200 text-brand-700 hover:bg-brand-50`}
          >
            {t('comeet.paste')}
          </button>
        </div>
      </div>
    )
    return (
      <section className={box}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">{t('comeet.title')}</h2>
            <p className="text-sm text-gray-600">{t('comeet.pitch')}</p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="btn-primary min-h-[44px] px-5">
            {t('comeet.start')}
          </button>
        </div>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={closeDialog}>
            <div
              role="dialog" aria-modal="true" aria-labelledby="comeet-dialog-title"
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-pop-in"
              onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') closeDialog() }}
            >
              <h2 id="comeet-dialog-title" className="text-lg font-semibold text-gray-900">{t('comeet.dialogTitle')}</h2>
              <div className="space-y-1">
                <p className="text-sm text-gray-600">{t('comeet.where')}</p>
                <a href={SETTINGS_URL} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-brand-700 underline">
                  {t('comeet.openSettings')}
                </a>
              </div>
              {field('uid', uid, setUid)}
              {field('token', secret, setSecret)}
              {pasteBlocked && <p className="text-sm text-amber-700">{t('comeet.pasteBlocked')}</p>}
              <p className="text-xs text-gray-500">{t('comeet.safe')}</p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={connect} disabled={!ready || busy} className="btn-primary min-h-[44px] px-5 disabled:opacity-50">
                  {t('comeet.connect')}
                </button>
                <button type="button" onClick={closeDialog} className={`${small} border-gray-200 text-gray-600`}>
                  {t('comeet.cancel')}
                </button>
              </div>
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
