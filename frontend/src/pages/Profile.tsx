import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import LangToggle from '../components/LangToggle'
import { useAuth } from '../hooks/useAuth'
import {
  getWorkerProfile,
  updateWorkerProfile,
  getEmployerProfile,
  updateEmployerProfile,
  uploadAvatar,
  uploadResume,
  getCvStatus,
  exportMyData,
  deleteMyAccount,
} from '../lib/api'
import { useNavigate } from 'react-router-dom'
import type { WorkerProfile, EmployerProfile, Tag } from '../lib/api'
import TagPicker from '../components/TagPicker'

// ---------------------------------------------------------------------------
// Avatar upload widget
// ---------------------------------------------------------------------------

function AvatarUploader({
  currentUrl,
  name,
  onUploaded,
  token,
}: {
  currentUrl: string | null
  name: string
  onUploaded: (url: string) => void
  token: string
}) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr(null)
    setUploading(true)
    try {
      const res = await uploadAvatar(token, file)
      onUploaded(res.url)
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('profile.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-5 mb-6">
      {/* Preview */}
      <div className="relative w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-brand-300 to-brand-500 flex-shrink-0">
        {currentUrl ? (
          <img src={currentUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-2xl font-bold text-white">{initials}</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-secondary text-sm"
        >
          {uploading ? t('profile.uploadingEllipsis') : t('profile.changePhoto')}
        </button>
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Worker profile form
// ---------------------------------------------------------------------------

function WorkerProfileForm({ token }: { token: string }) {
  const { t } = useTranslation()
  const [profile, setProfile] = useState<WorkerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editable fields
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [selectedTags, setSelectedTags] = useState<Tag[]>([])
  const [expYears, setExpYears] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  // Resume upload
  const [resumeUrl, setResumeUrl] = useState<string | null>(null)
  const [uploadingResume, setUploadingResume] = useState(false)
  const [resumeErr, setResumeErr] = useState<string | null>(null)
  const [cvAnalyzing, setCvAnalyzing] = useState(false)
  // One-shot success note written just before the post-extraction reload.
  const [cvFlash] = useState<string | null>(() => {
    try {
      const v = sessionStorage.getItem('cvFlash')
      if (v) sessionStorage.removeItem('cvFlash')
      return v
    } catch { return null }
  })
  const resumeRef = useRef<HTMLInputElement>(null)
  const cvPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    getWorkerProfile(token)
      .then((p) => {
        setProfile(p)
        setName(p.name)
        setBio(p.bio)
        setLocation(p.location)
        setSelectedTags(p.tags ?? [])
        setExpYears(String(p.experience_years))
        setAvatarUrl(p.avatar_url)
        setResumeUrl(p.resume_url)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('profile.failedToLoad'))
      })
      .finally(() => setLoading(false))
  }, [token])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSaving(true)
    try {
      await updateWorkerProfile(token, {
        name,
        bio,
        location,
        tag_ids: selectedTags.map((t) => t.id),
        experience_years: Number(expYears),
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleResumeUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResumeErr(null)
    setUploadingResume(true)
    try {
      const res = await uploadResume(token, file)
      setResumeUrl(res.url)
      setUploadingResume(false)
      setCvAnalyzing(true)
      // Poll until extraction is done then reload
      cvPollRef.current = setInterval(async () => {
        try {
          const status = await getCvStatus(token)
          if (status.cv_extraction_status === 'done') {
            clearInterval(cvPollRef.current!)
            const n = status.cv_extracted_tag_count
            try { sessionStorage.setItem('cvFlash', t('profile.cvAnalyzed', { count: n })) } catch { /* ignore */ }
            window.location.reload()
          } else if (status.cv_extraction_status === 'error') {
            clearInterval(cvPollRef.current!)
            setCvAnalyzing(false)
            setResumeErr(t('profile.cvReadError'))
          }
        } catch {
          clearInterval(cvPollRef.current!)
          setCvAnalyzing(false)
          setResumeErr(t('profile.cvCheckError'))
        }
      }, 2000)
    } catch (err) {
      setResumeErr(err instanceof Error ? err.message : t('profile.uploadFailed'))
      setUploadingResume(false)
    }
  }

  if (loading) return <Spinner />
  if (!profile) return <p className="text-sm text-red-500">{error}</p>

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <AvatarUploader
        currentUrl={avatarUrl}
        name={name || t('common.you')}
        onUploaded={setAvatarUrl}
        token={token}
      />

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {t('profile.savedSuccess')}
        </div>
      )}

      <div>
        <label className="label">{t('onboarding.worker.fullName')}</label>
        <input required className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="label">{t('profile.bio')}</label>
        <textarea
          required
          rows={3}
          className="input resize-none"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">{t('common.location')}</label>
          <input
            required
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('onboarding.worker.yearsExperience')}</label>
          <input
            required
            type="number"
            min={0}
            max={50}
            className="input"
            value={expYears}
            onChange={(e) => setExpYears(e.target.value)}
          />
        </div>
      </div>

      <TagPicker
        selectedTags={selectedTags}
        onChange={setSelectedTags}
      />

      {/* Resume */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700 mb-2">{t('profile.resume')}</p>

        {cvFlash && (
          <div className="mb-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700" role="status">
            {cvFlash}
          </div>
        )}

        {cvAnalyzing && (
          <div className="flex items-center gap-3 py-2">
            <svg className="animate-spin h-5 w-5 text-brand-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-sm text-gray-500">{t('profile.analyzingCv')}</span>
          </div>
        )}

        {!cvAnalyzing && resumeUrl ? (
          <div className="flex items-center gap-3">
            <a
              href={resumeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brand-600 hover:underline truncate"
            >
              {t('profile.viewCurrentResume')}
            </a>
            <button
              type="button"
              onClick={() => resumeRef.current?.click()}
              disabled={uploadingResume}
              className="btn-secondary text-xs py-1 px-2.5"
            >
              {t('profile.replace')}
            </button>
          </div>
        ) : !cvAnalyzing ? (
          <button
            type="button"
            onClick={() => resumeRef.current?.click()}
            disabled={uploadingResume}
            className="btn-secondary text-sm"
          >
            {uploadingResume ? t('profile.uploadingEllipsis') : t('profile.uploadResume')}
          </button>
        ) : null}
        {resumeErr && <p className="text-xs text-red-500 mt-1">{resumeErr}</p>}
        <input
          ref={resumeRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={handleResumeUpload}
        />
      </div>

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-base">
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {t('profile.savingEllipsis')}
          </span>
        ) : (
          t('profile.saveChanges')
        )}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Employer profile form
// ---------------------------------------------------------------------------

function EmployerProfileForm({ token }: { token: string }) {
  const { t } = useTranslation()
  const [profile, setProfile] = useState<EmployerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [companyName, setCompanyName] = useState('')
  const [description, setDescription] = useState('')
  const [industry, setIndustry] = useState('')
  const [location, setLocation] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    getEmployerProfile(token)
      .then((p) => {
        setProfile(p)
        setCompanyName(p.company_name)
        setDescription(p.description)
        setIndustry(p.industry)
        setLocation(p.location)
        setAvatarUrl(p.avatar_url)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('profile.failedToLoad'))
      })
      .finally(() => setLoading(false))
  }, [token])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSaving(true)
    try {
      await updateEmployerProfile(token, {
        company_name: companyName,
        description,
        industry,
        location,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />
  if (!profile) return <p className="text-sm text-red-500">{error}</p>

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <AvatarUploader
        currentUrl={avatarUrl}
        name={companyName || t('profile.companyFallback')}
        onUploaded={setAvatarUrl}
        token={token}
      />

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {t('profile.savedSuccess')}
        </div>
      )}

      <div>
        <label className="label">{t('onboarding.employer.companyName')}</label>
        <input
          required
          className="input"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
      </div>

      <div>
        <label className="label">{t('common.description')}</label>
        <textarea
          required
          rows={4}
          className="input resize-none"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">{t('onboarding.employer.industry')}</label>
          <input
            required
            className="input"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('common.location')}</label>
          <input
            required
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-base">
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {t('profile.savingEllipsis')}
          </span>
        ) : (
          t('profile.saveChanges')
        )}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Profile() {
  const { t } = useTranslation()
  const { session, role, signOut } = useAuth()
  const token = session?.access_token ?? ''
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const data = await exportMyData(token)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'jobswipe-my-data.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silent */ }
    setExporting(false)
  }

  async function handleDelete() {
    if (!confirm(t('profile.confirmDelete1'))) return
    if (!confirm(t('profile.confirmDelete2'))) return
    setDeleting(true)
    try {
      await deleteMyAccount(token)
      await signOut()
      navigate('/', { replace: true })
    } catch { /* silent */ }
    setDeleting(false)
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg">
        {/* Phones have no room for the toggle in the navbar; offer it here. */}
        <div className="flex justify-end mb-3 sm:hidden"><LangToggle /></div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {role === 'employer' ? t('profile.companyProfile') : t('profile.yourProfile')}
        </h1>

        <div className="bg-white rounded-3xl shadow-xl shadow-gray-100 p-6 sm:p-8">
          {role === 'employer' ? (
            <EmployerProfileForm token={token} />
          ) : (
            <WorkerProfileForm token={token} />
          )}
        </div>

        {/* Data & Privacy */}
        <div className="mt-8 bg-white rounded-3xl shadow-xl shadow-gray-100 p-6 sm:p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4">{t('profile.dataPrivacy')}</h2>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-1">{t('profile.downloadYourData')}</h3>
              <p className="text-xs text-gray-500 mb-2">{t('profile.downloadYourDataHint')}</p>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="text-sm font-medium text-brand-600 hover:text-brand-700 px-4 py-2 rounded-xl border border-brand-200 hover:bg-brand-50 transition-colors disabled:opacity-50"
              >
                {exporting ? t('profile.preparing') : t('profile.downloadMyData')}
              </button>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-medium text-red-600 mb-1">{t('profile.deleteAccount')}</h3>
              <p className="text-xs text-gray-500 mb-2">{t('profile.deleteAccountHint')}</p>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm font-medium text-red-500 hover:text-red-700 px-4 py-2 rounded-xl border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {deleting ? t('profile.deletingEllipsis') : t('profile.deleteMyAccount')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
    </div>
  )
}
