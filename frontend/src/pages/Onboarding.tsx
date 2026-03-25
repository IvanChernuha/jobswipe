import { useState, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { updateWorkerProfile, updateEmployerProfile, uploadAvatar } from '../lib/api'
import type { Tag } from '../lib/api'
import TagPicker from '../components/TagPicker'

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i < current ? 'bg-brand-500' : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Worker form data
// ---------------------------------------------------------------------------

interface WorkerFormData {
  name: string
  bio: string
  location: string
  tag_ids: string[]
  experience_years: string
  avatarFile: File | null
}

function WorkerOnboarding({
  onSubmit,
  loading,
  onStepChange,
}: {
  onSubmit: (data: WorkerFormData) => void
  loading: boolean
  onStepChange: (step: number) => void
}) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [expYears, setExpYears] = useState('')
  const [selectedTags, setSelectedTags] = useState<Tag[]>([])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleNext(e: FormEvent) {
    e.preventDefault()
    setStep(2)
    onStepChange(2)
  }

  function handleBack() {
    setStep(1)
    onStepChange(1)
  }

  function handleFinish(e: FormEvent) {
    e.preventDefault()
    onSubmit({
      name,
      bio,
      location,
      tag_ids: selectedTags.map((t) => t.id),
      experience_years: expYears,
      avatarFile,
    })
  }

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  if (step === 1) {
    return (
      <form onSubmit={handleNext} className="space-y-5">
        {/* Avatar upload */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-brand-300 to-brand-500
                       flex items-center justify-center hover:opacity-90 transition-opacity group"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-white">
                {initials || (
                  <svg className="w-8 h-8 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                )}
              </span>
            )}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
          <p className="text-xs text-gray-400">Tap to add a photo</p>
        </div>

        <div>
          <label className="label">Full name</label>
          <input
            required
            className="input"
            placeholder="Alex Johnson"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Short bio</label>
          <textarea
            required
            rows={3}
            className="input resize-none"
            placeholder="Tell employers about yourself..."
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Location</label>
            <input
              required
              className="input"
              placeholder="San Francisco, CA"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Years of experience</label>
            <input
              required
              type="number"
              min={0}
              max={50}
              className="input"
              placeholder="3"
              value={expYears}
              onChange={(e) => setExpYears(e.target.value)}
            />
          </div>
        </div>

        <button type="submit" className="btn-primary w-full py-3 text-base mt-2">
          Next — Pick your skills
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleFinish} className="space-y-5">
      <p className="text-sm text-gray-500">
        Select the technologies and skills you work with. These help match you with the right jobs.
      </p>

      <TagPicker selectedTags={selectedTags} onChange={setSelectedTags} />

      <div className="flex gap-3 mt-2">
        <button type="button" onClick={handleBack} className="flex-1 py-3 text-base font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          Back
        </button>
        <button type="submit" disabled={loading} className="flex-1 btn-primary py-3 text-base">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            'Complete profile'
          )}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Employer form data
// ---------------------------------------------------------------------------

interface EmployerFormData {
  company_name: string
  description: string
  industry: string
  location: string
  logoFile: File | null
}

function EmployerOnboarding({
  onSubmit,
  loading,
}: {
  onSubmit: (data: EmployerFormData) => void
  loading: boolean
}) {
  const [form, setForm] = useState({
    company_name: '',
    description: '',
    industry: '',
    location: '',
  })
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ ...form, logoFile })
  }

  const initials = form.company_name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Logo upload */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative w-24 h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-brand-300 to-brand-500
                     flex items-center justify-center hover:opacity-90 transition-opacity group"
        >
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-white">
              {initials || (
                <svg className="w-8 h-8 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              )}
            </span>
          )}
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLogoChange} />
        <p className="text-xs text-gray-400">Tap to add company logo</p>
      </div>

      <div>
        <label className="label">Company name</label>
        <input
          required
          className="input"
          placeholder="Acme Corp"
          value={form.company_name}
          onChange={set('company_name')}
        />
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          required
          rows={3}
          className="input resize-none"
          placeholder="What does your company do? What's the culture like?"
          value={form.description}
          onChange={set('description')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Industry</label>
          <input
            required
            className="input"
            placeholder="Technology"
            value={form.industry}
            onChange={set('industry')}
          />
        </div>
        <div>
          <label className="label">Location</label>
          <input
            required
            className="input"
            placeholder="New York, NY"
            value={form.location}
            onChange={set('location')}
          />
        </div>
      </div>

      <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-2">
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Saving...
          </span>
        ) : (
          'Complete profile'
        )}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Onboarding() {
  const { role, session } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const token = session?.access_token ?? ''

  const [workerStep, setWorkerStep] = useState(1)

  async function handleWorkerSubmit(data: WorkerFormData) {
    setError(null)
    setLoading(true)
    try {
      // Upload avatar first if provided
      if (data.avatarFile) {
        await uploadAvatar(token, data.avatarFile)
      }
      await updateWorkerProfile(token, {
        name: data.name,
        bio: data.bio,
        location: data.location,
        tag_ids: data.tag_ids,
        experience_years: Number(data.experience_years),
      })
      navigate('/feed', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmployerSubmit(data: EmployerFormData) {
    setError(null)
    setLoading(true)
    try {
      if (data.logoFile) {
        await uploadAvatar(token, data.logoFile)
      }
      await updateEmployerProfile(token, {
        company_name: data.company_name,
        description: data.description,
        industry: data.industry,
        location: data.location,
      })
      navigate('/feed', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-purple-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-100 p-8 sm:p-10">
          <StepIndicator current={role === 'worker' ? workerStep : 1} total={role === 'worker' ? 2 : 1} />

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              {role === 'employer'
                ? 'Tell us about your company'
                : workerStep === 1
                  ? 'Tell us about yourself'
                  : 'Pick your skills'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {role === 'employer'
                ? 'This information appears on your public profile.'
                : workerStep === 1
                  ? 'This information appears on your public profile.'
                  : 'Help us match you with the right opportunities.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {role === 'employer' ? (
            <EmployerOnboarding onSubmit={handleEmployerSubmit} loading={loading} />
          ) : (
            <WorkerOnboarding onSubmit={handleWorkerSubmit} loading={loading} onStepChange={setWorkerStep} />
          )}
        </div>
      </div>
    </div>
  )
}
