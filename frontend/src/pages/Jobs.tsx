import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  getJobPostings, toggleJobActive, deleteJobPosting, updateJobPosting,
  createJobPosting, parseJobFiles,
  type JobPosting, type Tag, type ParsedJobFile,
} from '../lib/api'
import TagPicker from '../components/TagPicker'
import TagBadge from '../components/TagBadge'

export default function Jobs() {
  const { session } = useAuth()
  const token = session?.access_token ?? ''

  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingJob, setEditingJob] = useState<JobPosting | null>(null)
  const [createModal, setCreateModal] = useState<{ open: boolean; prefilled: ParsedJobFile | null }>({ open: false, prefilled: null })
  const [parsedJobs, setParsedJobs] = useState<ParsedJobFile[] | null>(null)
  const [parsing, setParsing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    getJobPostings(token)
      .then(setJobs)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleToggle(jobId: string) {
    try {
      const updated = await toggleJobActive(token, jobId)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, active: updated.active } : j)))
    } catch { /* silent */ }
  }

  async function handleDelete(jobId: string) {
    if (!confirm('Delete this job posting? This cannot be undone.')) return
    try {
      await deleteJobPosting(token, jobId)
      setJobs((prev) => prev.filter((j) => j.id !== jobId))
    } catch { /* silent */ }
  }

  async function handleSaveEdit(jobId: string, data: Record<string, unknown>) {
    try {
      const updated = await updateJobPosting(token, jobId, data)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...updated } : j)))
      setEditingJob(null)
    } catch { /* silent */ }
  }

  async function handleCreate(data: Record<string, unknown>) {
    try {
      const created = await createJobPosting(token, data as any)
      setJobs((prev) => [{ ...created, swipe_count: 0, like_count: 0, match_count: 0, active: true } as JobPosting, ...prev])
      setCreateModal({ open: false, prefilled: null })
    } catch { /* silent */ }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = ''
    setParsing(true)
    try {
      const results = await parseJobFiles(token, files)
      if (results.length === 1 && !results[0].error) {
        // Single file → pre-fill the create form
        setCreateModal({ open: true, prefilled: results[0] })
      } else {
        // Multiple files → show review list
        setParsedJobs(results)
      }
    } catch { /* silent */ }
    finally { setParsing(false) }
  }

  async function handleCreateParsed(parsed: ParsedJobFile) {
    try {
      const created = await createJobPosting(token, {
        title: parsed.title ?? 'Untitled',
        description: parsed.description ?? '',
        location: parsed.location ?? '',
        remote: parsed.remote,
        salary_min: parsed.salary_min ?? 0,
        salary_max: parsed.salary_max ?? 0,
        min_experience_years: parsed.min_experience_years ?? null,
        tag_ids: parsed.tag_ids,
        required_tag_ids: parsed.required_tag_ids,
        preferred_tag_ids: parsed.preferred_tag_ids,
        expires_in_days: 30,
      } as any)
      setJobs((prev) => [{ ...created, swipe_count: 0, like_count: 0, match_count: 0, active: true } as JobPosting, ...prev])
      setParsedJobs((prev) => prev?.filter((p) => p.filename !== parsed.filename) ?? null)
    } catch { /* silent */ }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading jobs...</p>
        </div>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center max-w-sm mx-auto mt-10">
          <p className="text-red-700 font-medium">{error}</p>
        </div>
      </Shell>
    )
  }

  const now = new Date()
  const activeJobs = jobs.filter((j) => j.active && new Date(j.expires_at) > now)
  const expiredJobs = jobs.filter((j) => j.active && new Date(j.expires_at) <= now)
  const inactiveJobs = jobs.filter((j) => !j.active)

  return (
    <Shell>
      <div className="max-w-3xl w-full px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Your Jobs</h1>
            <p className="text-sm text-gray-500 mt-0.5">{jobs.length} posting{jobs.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="btn-secondary text-sm py-2 px-4 flex items-center gap-1.5"
            >
              {parsing ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
              {parsing ? 'Analyzing...' : 'Upload Job File'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => setCreateModal({ open: true, prefilled: null })}
              className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New Job
            </button>
          </div>
        </div>

        {/* Bulk review list */}
        {parsedJobs && parsedJobs.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                Review parsed jobs ({parsedJobs.length} remaining)
              </h2>
              <button onClick={() => setParsedJobs(null)} className="text-xs text-gray-400 hover:text-gray-600">
                Dismiss all
              </button>
            </div>
            <div className="space-y-3">
              {parsedJobs.map((parsed) => (
                <ParsedJobCard
                  key={parsed.filename}
                  parsed={parsed}
                  onCreate={() => handleCreateParsed(parsed)}
                  onEdit={() => { setCreateModal({ open: true, prefilled: parsed }); setParsedJobs(null) }}
                  onDiscard={() => setParsedJobs((prev) => prev?.filter((p) => p.filename !== parsed.filename) ?? null)}
                />
              ))}
            </div>
            {parsedJobs.filter((p) => !p.error).length > 1 && (
              <button
                onClick={async () => {
                  for (const p of parsedJobs.filter((j) => !j.error)) {
                    await handleCreateParsed(p)
                  }
                }}
                className="mt-4 w-full btn-primary py-2.5 text-sm"
              >
                Create All ({parsedJobs.filter((p) => !p.error).length} jobs)
              </button>
            )}
          </div>
        )}

        {/* Create modal */}
        {createModal.open && (
          <JobFormModal
            prefilled={createModal.prefilled ?? undefined}
            onSave={(data) => handleCreate(data)}
            onClose={() => setCreateModal({ open: false, prefilled: null })}
            title="Create Job Posting"
          />
        )}

        {/* Edit modal */}
        {editingJob && (
          <JobFormModal
            job={editingJob}
            onSave={(data) => handleSaveEdit(editingJob.id, data)}
            onClose={() => setEditingJob(null)}
            title="Edit Job Posting"
          />
        )}

        {/* Empty state */}
        {jobs.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📋</p>
            <h2 className="text-xl font-bold text-gray-800 mb-2">No job postings yet</h2>
            <p className="text-gray-500 text-sm mb-4">Create your first job to start receiving candidates.</p>
            <button onClick={() => setCreateModal({ open: true, prefilled: null })} className="btn-primary text-sm">
              Create Job
            </button>
          </div>
        )}

        {/* Active jobs */}
        {activeJobs.length > 0 && (
          <div className="space-y-3 mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Active ({activeJobs.length})
            </h2>
            {activeJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onToggle={() => handleToggle(job.id)}
                onEdit={() => setEditingJob(job)}
                onDelete={() => handleDelete(job.id)}
              />
            ))}
          </div>
        )}

        {/* Expired jobs */}
        {expiredJobs.length > 0 && (
          <div className="space-y-3 mb-8">
            <h2 className="text-sm font-semibold text-amber-600 uppercase tracking-wide">
              Expired ({expiredJobs.length})
            </h2>
            {expiredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onToggle={() => handleToggle(job.id)}
                onEdit={() => setEditingJob(job)}
                onDelete={() => handleDelete(job.id)}
                onExtend={async (days) => {
                  try {
                    const updated = await updateJobPosting(token, job.id, { expires_in_days: days })
                    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...updated } : j)))
                  } catch { /* silent */ }
                }}
                expired
              />
            ))}
          </div>
        )}

        {/* Inactive jobs */}
        {inactiveJobs.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Inactive ({inactiveJobs.length})
            </h2>
            {inactiveJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onToggle={() => handleToggle(job.id)}
                onEdit={() => setEditingJob(job)}
                onDelete={() => handleDelete(job.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Job card
// ---------------------------------------------------------------------------

function JobCard({
  job,
  onToggle,
  onEdit,
  onDelete,
  onExtend,
  expired,
}: {
  job: JobPosting
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onExtend?: (days: number) => void
  expired?: boolean
}) {
  const posted = new Date(job.created_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const expiresDate = new Date(job.expires_at)
  const now = new Date()
  const daysLeft = Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const expiryLabel = expired
    ? `Expired ${expiresDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : daysLeft <= 7
      ? `Expires in ${daysLeft}d`
      : `Expires ${expiresDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  const expiryColor = expired
    ? 'text-red-500'
    : daysLeft <= 3
      ? 'text-red-500'
      : daysLeft <= 7
        ? 'text-amber-500'
        : 'text-gray-400'

  const salary =
    job.salary_min || job.salary_max
      ? `$${((job.salary_min ?? 0) / 1000).toFixed(0)}k – $${((job.salary_max ?? 0) / 1000).toFixed(0)}k`
      : null

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${
      expired ? 'border-amber-200 bg-amber-50/30' : job.active ? 'border-gray-100 hover:shadow-md' : 'border-gray-200 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{job.title}</h3>
            {expired && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-full uppercase">
                Expired
              </span>
            )}
            {!job.active && !expired && (
              <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-semibold rounded-full uppercase">
                Inactive
              </span>
            )}
            {job.remote && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-semibold rounded-full">
                Remote
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {job.location && <span>{job.location}</span>}
            {salary && <span>{salary}</span>}
            <span>Posted {posted}</span>
            <span className={expiryColor}>{expiryLabel}</span>
          </div>

          {job.description && (
            <p className="text-sm text-gray-600 mt-2 line-clamp-2">{job.description}</p>
          )}

          {/* Tags */}
          {job.tags && job.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {job.tags.slice(0, 6).map((tag) => (
                <TagBadge key={tag.id} tag={tag} />
              ))}
              {job.tags.length > 6 && (
                <span className="text-xs text-gray-400 self-center">+{job.tags.length - 6} more</span>
              )}
            </div>
          )}
        </div>

        {/* Stats column */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1 text-right">
          <StatPill label="Views" value={job.swipe_count} color="gray" />
          <StatPill label="Likes" value={job.like_count} color="green" />
          <StatPill label="Matches" value={job.match_count} color="brand" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
        <button
          onClick={onEdit}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Edit
        </button>
        {expired && onExtend ? (
          <>
            <button
              onClick={() => onExtend(30)}
              className="text-xs font-medium text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
            >
              Extend 30d
            </button>
            <button
              onClick={() => onExtend(7)}
              className="text-xs font-medium text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Extend 7d
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              job.active
                ? 'text-amber-600 hover:bg-amber-50'
                : 'text-green-600 hover:bg-green-50'
            }`}
          >
            {job.active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onDelete}
          className="text-xs font-medium text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-50 text-gray-600',
    green: 'bg-green-50 text-green-600',
    brand: 'bg-brand-50 text-brand-600',
  }
  return (
    <div className={`px-2.5 py-1 rounded-lg text-xs font-medium ${colors[color] ?? colors.gray}`}>
      <span className="font-bold">{value}</span> {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job form modal (create + edit)
// ---------------------------------------------------------------------------

function JobFormModal({
  job,
  prefilled,
  onSave,
  onClose,
  title,
}: {
  job?: JobPosting
  prefilled?: ParsedJobFile
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
  title: string
}) {
  const defaultDays = job?.expires_at
    ? Math.max(1, Math.ceil((new Date(job.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 30
  const [form, setForm] = useState({
    title: job?.title ?? prefilled?.title ?? '',
    description: job?.description ?? prefilled?.description ?? '',
    location: job?.location ?? prefilled?.location ?? '',
    salary_min: job?.salary_min ?? prefilled?.salary_min ?? 0,
    salary_max: job?.salary_max ?? prefilled?.salary_max ?? 0,
    remote: job?.remote ?? prefilled?.remote ?? false,
    min_experience_years: job?.min_experience_years ?? prefilled?.min_experience_years ?? '',
    expires_in_days: defaultDays,
  })
  console.log('JobFormModal mount, prefilled:', prefilled)
  const [selectedTags, setSelectedTags] = useState<Tag[]>(() => {
    if (job) return job.tags?.filter((t) => !t.requirement || t.requirement === 'nice') ?? []
    if (prefilled) return prefilled.tag_ids.map((id, i) => ({ id, name: prefilled.nice_tags[i] ?? id, category: '' }))
    return []
  })
  const [requiredTags, setRequiredTags] = useState<Tag[]>(() => {
    if (job) return job.tags?.filter((t) => t.requirement === 'required') ?? []
    if (prefilled) return prefilled.required_tag_ids.map((id, i) => ({ id, name: prefilled.required_tags[i] ?? id, category: '' }))
    return []
  })
  const [preferredTags, setPreferredTags] = useState<Tag[]>(() => {
    if (job) return job.tags?.filter((t) => t.requirement === 'preferred') ?? []
    if (prefilled) return prefilled.preferred_tag_ids.map((id, i) => ({ id, name: prefilled.preferred_tags[i] ?? id, category: '' }))
    return []
  })
  console.log('requiredTags initial:', requiredTags, 'preferredTags:', preferredTags, 'selectedTags:', selectedTags)
  const [saving, setSaving] = useState(false)

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const val = e.target.type === 'number' ? Number(e.target.value) : e.target.value
      setForm((prev) => ({ ...prev, [field]: val }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      min_experience_years: form.min_experience_years === '' || form.min_experience_years === 0 ? null : Number(form.min_experience_years),
      tag_ids: selectedTags.map((t) => t.id),
      required_tag_ids: requiredTags.map((t) => t.id),
      preferred_tag_ids: preferredTags.map((t) => t.id),
    }
    console.log('JobFormModal submit payload:', payload)
    await onSave(payload)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 mb-5">{title}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Job title</label>
            <input required className="input" value={form.title} onChange={set('title')} placeholder="Senior Frontend Engineer" />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea rows={3} className="input resize-none" value={form.description} onChange={set('description')} placeholder="What will this person do?" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Location</label>
              <input className="input" value={form.location} onChange={set('location')} placeholder="New York, NY" />
            </div>
            <label className="flex items-center gap-2 self-end cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={form.remote}
                onChange={(e) => setForm((prev) => ({ ...prev, remote: e.target.checked }))}
                className="rounded border-gray-300 text-brand-500 focus:ring-brand-300"
              />
              <span className="text-sm text-gray-700">Remote</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Min salary ($)</label>
              <input type="number" min={0} className="input" value={form.salary_min} onChange={set('salary_min')} />
            </div>
            <div>
              <label className="label">Max salary ($)</label>
              <input type="number" min={0} className="input" value={form.salary_max} onChange={set('salary_max')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Min experience (years)</label>
              <input type="number" min={0} className="input" value={form.min_experience_years} onChange={set('min_experience_years')} placeholder="Optional" />
            </div>
            <div>
              <label className="label">Listing duration (days)</label>
              <input type="number" min={1} max={365} className="input" value={form.expires_in_days} onChange={set('expires_in_days')} />
            </div>
          </div>

          <div>
            <label className="label">Required tags (must have ALL)</label>
            <TagPicker selectedTags={requiredTags} onChange={setRequiredTags} />
          </div>

          <div>
            <label className="label">Preferred tags (must have at least 1)</label>
            <TagPicker selectedTags={preferredTags} onChange={setPreferredTags} />
          </div>

          <div>
            <label className="label">Nice-to-have tags</label>
            <TagPicker selectedTags={selectedTags} onChange={setSelectedTags} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 text-sm">
              {saving ? 'Saving...' : job ? 'Save Changes' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ParsedJobCard({
  parsed,
  onCreate,
  onEdit,
  onDiscard,
}: {
  parsed: ParsedJobFile
  onCreate: () => void
  onEdit: () => void
  onDiscard: () => void
}) {
  if (parsed.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-red-700">{parsed.filename}</p>
          <p className="text-xs text-red-500 mt-0.5">{parsed.error}</p>
        </div>
        <button onClick={onDiscard} className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100">
          Dismiss
        </button>
      </div>
    )
  }

  const salary = parsed.salary_min || parsed.salary_max
    ? `$${((parsed.salary_min ?? 0) / 1000).toFixed(0)}k – $${((parsed.salary_max ?? 0) / 1000).toFixed(0)}k`
    : null

  const allTags = [...parsed.required_tags, ...parsed.preferred_tags, ...parsed.nice_tags]

  return (
    <div className="bg-white border border-brand-100 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-400 mb-1">{parsed.filename}</p>
          <h3 className="font-semibold text-gray-900">{parsed.title ?? 'Untitled'}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
            {parsed.location && <span>{parsed.location}</span>}
            {parsed.remote && <span className="text-blue-500">Remote</span>}
            {salary && <span>{salary}</span>}
          </div>
          {parsed.description && (
            <p className="text-sm text-gray-600 mt-2 line-clamp-2">{parsed.description}</p>
          )}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {allTags.slice(0, 8).map((t) => (
                <span key={t} className="px-2 py-0.5 bg-brand-50 text-brand-600 text-xs rounded-full">{t}</span>
              ))}
              {allTags.length > 8 && <span className="text-xs text-gray-400 self-center">+{allTags.length - 8} more</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
        <button onClick={onCreate} className="btn-primary text-xs py-1.5 px-3">
          Create
        </button>
        <button onClick={onEdit} className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100">
          Edit before creating
        </button>
        <div className="flex-1" />
        <button onClick={onDiscard} className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50">
          Discard
        </button>
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center">
      {children}
    </div>
  )
}
