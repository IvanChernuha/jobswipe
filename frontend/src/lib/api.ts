// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = 'worker' | 'employer'

export interface AuthResponse {
  access_token: string
  token_type: string
  user: {
    id: string
    email: string
    role: Role
  }
}

export interface WorkerProfile {
  id: string
  user_id: string
  name: string
  bio: string
  location: string
  skills: string[]
  experience_years: number
  avatar_url: string | null
  resume_url: string | null
  tags: Tag[]
}

export interface EmployerProfile {
  id: string
  user_id: string
  company_name: string
  description: string
  industry: string
  location: string
  avatar_url: string | null
}

export interface JobPosting {
  id: string
  employer_id: string
  title: string
  description: string
  location: string
  salary_min: number | null
  salary_max: number | null
  skills_required: string[]
  remote: boolean
  active: boolean
  created_at: string
  expires_at: string
  min_experience_years: number | null
  tags: Tag[]
  swipe_count: number
  like_count: number
  match_count: number
}

// Cards shown in the feed
export interface WorkerCard {
  id: string
  name: string
  avatar_url: string | null
  bio: string
  location: string
  skills: string[]
  experience_years: number
  tags: Tag[]
  match_score?: MatchScore | null
}

export interface EmployerCard {
  id: string
  company_name: string
  avatar_url: string | null
  description: string
  location: string
  industry: string
  job_title: string
  salary_min: number | null
  salary_max: number | null
  skills_required: string[]
  tags: Tag[]
  match_score?: MatchScore | null
}

export interface SwipeRequest {
  target_id: string
  direction: 'like' | 'pass' | 'super_like'
}

export interface Bookmark {
  id: string
  user_id: string
  target_id: string
  job_posting_id: string | null
  note: string
  created_at: string
  expires_at: string
}

export interface BookmarkGroup {
  job_posting_id: string | null
  job_title: string
  bookmarks: Bookmark[]
}

export interface SwipeResponse {
  matched: boolean
  match_id: string | null
}

export interface UndoResponse {
  undone: boolean
  target_id: string | null
}

export interface FeedFilters {
  location?: string
  salary_min?: number
  remote?: boolean
  experience_min?: number
  experience_max?: number
}

export interface Match {
  id: string
  worker_id: string
  employer_id: string
  job_posting_id: string | null
  matched_at: string
  status: string
  worker?: {
    name: string
    avatar_url: string | null
    skills: string[]
    experience_years: number
  }
  employer?: {
    company_name: string
    industry: string
    avatar_url: string | null
    job_title: string
    location: string
  }
  contact_email?: string
}

export interface Tag {
  id: string
  name: string
  category: string
  requirement?: 'required' | 'preferred' | 'nice' | null
}

export interface MatchScore {
  matched: number
  total: number
  percentage: number
}

export interface TagCategory {
  value: string
  label: string
}

export interface UploadResponse {
  url: string
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers: extraHeaders, ...rest } = options

  const headers: HeadersInit = {
    // Skip Content-Type for FormData — browser must auto-set multipart boundary
    ...(rest.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extraHeaders ?? {}),
  }

  const res = await fetch(`${BASE_URL}${path}`, { headers, ...rest })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: string; message?: string }
      message = body.detail ?? body.message ?? message
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function registerUser(
  email: string,
  password: string,
  role: Role,
): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, role }),
  })
}

export function loginUser(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

// ---------------------------------------------------------------------------
// Worker profile
// ---------------------------------------------------------------------------

export function getWorkerProfile(token: string): Promise<WorkerProfile> {
  return request<WorkerProfile>('/workers/me', { token })
}

export function updateWorkerProfile(
  token: string,
  data: Partial<Omit<WorkerProfile, 'id' | 'user_id' | 'avatar_url' | 'resume_url' | 'tags'>> & { tag_ids?: string[] },
): Promise<WorkerProfile> {
  return request<WorkerProfile>('/workers/me', {
    method: 'PUT',
    token,
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// Employer profile
// ---------------------------------------------------------------------------

export function getEmployerProfile(token: string): Promise<EmployerProfile> {
  return request<EmployerProfile>('/employers/me', { token })
}

export function updateEmployerProfile(
  token: string,
  data: Partial<Omit<EmployerProfile, 'id' | 'user_id' | 'avatar_url'>>,
): Promise<EmployerProfile> {
  return request<EmployerProfile>('/employers/me', {
    method: 'PUT',
    token,
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export function getWorkerFeed(token: string, filters?: FeedFilters): Promise<EmployerCard[]> {
  const params = new URLSearchParams()
  if (filters?.location) params.set('location', filters.location)
  if (filters?.salary_min != null) params.set('salary_min', String(filters.salary_min))
  if (filters?.remote != null) params.set('remote', String(filters.remote))
  const qs = params.toString()
  return request<EmployerCard[]>(`/employers/feed${qs ? `?${qs}` : ''}`, { token })
}

export function getEmployerFeed(token: string, filters?: FeedFilters): Promise<WorkerCard[]> {
  const params = new URLSearchParams()
  if (filters?.location) params.set('location', filters.location)
  if (filters?.experience_min != null) params.set('experience_min', String(filters.experience_min))
  if (filters?.experience_max != null) params.set('experience_max', String(filters.experience_max))
  const qs = params.toString()
  return request<WorkerCard[]>(`/workers/feed${qs ? `?${qs}` : ''}`, { token })
}

// ---------------------------------------------------------------------------
// Swipes
// ---------------------------------------------------------------------------

export function postSwipe(token: string, data: SwipeRequest): Promise<SwipeResponse> {
  return request<SwipeResponse>('/swipes', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export function undoLastSwipe(token: string): Promise<UndoResponse> {
  return request<UndoResponse>('/swipes/last', {
    method: 'DELETE',
    token,
  })
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export function getMatches(token: string): Promise<Match[]> {
  return request<Match[]>('/matches', { token })
}

export function getMatch(token: string, matchId: string): Promise<Match> {
  return request<Match>(`/matches/${matchId}`, { token })
}

// ---------------------------------------------------------------------------
// Job postings
// ---------------------------------------------------------------------------

export function createJobPosting(
  token: string,
  data: Omit<JobPosting, 'id' | 'employer_id' | 'created_at'> & { expires_in_days?: number },
): Promise<JobPosting> {
  return request<JobPosting>('/employers/jobs', {
    method: 'POST',
    token,
    body: JSON.stringify(data),
  })
}

export function getJobPostings(token: string): Promise<JobPosting[]> {
  return request<JobPosting[]>('/employers/jobs', { token })
}

export function updateJobPosting(
  token: string,
  jobId: string,
  data: Partial<Omit<JobPosting, 'id' | 'employer_id' | 'created_at' | 'swipe_count' | 'like_count' | 'match_count'>> & { expires_in_days?: number },
): Promise<JobPosting> {
  return request<JobPosting>(`/employers/jobs/${jobId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(data),
  })
}

export function toggleJobActive(token: string, jobId: string): Promise<JobPosting> {
  return request<JobPosting>(`/employers/jobs/${jobId}/toggle`, {
    method: 'PATCH',
    token,
  })
}

export function deleteJobPosting(token: string, jobId: string): Promise<void> {
  return request<void>(`/employers/jobs/${jobId}`, {
    method: 'DELETE',
    token,
  })
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export function uploadAvatar(token: string, file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  return request<UploadResponse>('/uploads/avatar', {
    method: 'POST',
    token,
    // Let browser set multipart Content-Type with boundary
    headers: {},
    body: form,
  })
}

export function uploadResume(token: string, file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  return request<UploadResponse>('/uploads/resume', {
    method: 'POST',
    token,
    headers: {},
    body: form,
  })
}

export function getCvStatus(token: string): Promise<{ cv_extraction_status: string | null; cv_extracted_tag_count: number }> {
  return request('/cv/status', { token })
}

export interface ParsedJobFile {
  filename: string
  title: string | null
  description: string | null
  location: string | null
  remote: boolean
  salary_min: number | null
  salary_max: number | null
  required_tag_ids: string[]
  preferred_tag_ids: string[]
  tag_ids: string[]
  required_tags: string[]
  preferred_tags: string[]
  nice_tags: string[]
  min_experience_years: number | null
  error: string | null
}

export async function parseJobFiles(token: string, files: File[]): Promise<ParsedJobFile[]> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const res = await request<{ parsed: ParsedJobFile[] }>('/cv/parse-job-files', {
    method: 'POST',
    token,
    headers: {},
    body: form,
  })
  return res.parsed
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export interface Org {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface OrgMember {
  id: string
  user_id: string
  email: string
  role: string
  created_at: string
}

export interface OrgInvite {
  id: string
  email: string
  role: string
  token: string
  used: boolean
  expires_at: string
}

export interface OrgMembership {
  has_org: boolean
  role: string | null
  org_id: string | null
}

export function getMyOrg(token: string): Promise<Org> {
  return request<Org>('/org', { token })
}

export function createOrg(token: string, name: string): Promise<Org> {
  return request<Org>('/org', { method: 'POST', token, body: JSON.stringify({ name }) })
}

export function updateOrg(token: string, name: string): Promise<Org> {
  return request<Org>('/org', { method: 'PUT', token, body: JSON.stringify({ name }) })
}

export function getOrgMembers(token: string): Promise<OrgMember[]> {
  return request<OrgMember[]>('/org/members', { token })
}

export function updateMemberRole(token: string, memberId: string, role: string): Promise<OrgMember> {
  return request<OrgMember>(`/org/members/${memberId}`, {
    method: 'PATCH', token, body: JSON.stringify({ role }),
  })
}

export function removeMember(token: string, memberId: string): Promise<void> {
  return request<void>(`/org/members/${memberId}`, { method: 'DELETE', token })
}

export function getOrgInvites(token: string): Promise<OrgInvite[]> {
  return request<OrgInvite[]>('/org/invites', { token })
}

export function createInvite(token: string, email: string, role: string): Promise<OrgInvite> {
  return request<OrgInvite>('/org/invites', {
    method: 'POST', token, body: JSON.stringify({ email, role }),
  })
}

export function revokeInvite(token: string, inviteId: string): Promise<void> {
  return request<void>(`/org/invites/${inviteId}`, { method: 'DELETE', token })
}

export function joinOrg(token: string, inviteToken: string): Promise<OrgMember> {
  return request<OrgMember>(`/org/join?token=${encodeURIComponent(inviteToken)}`, {
    method: 'POST', token,
  })
}

export function getMyMembership(token: string): Promise<OrgMembership> {
  return request<OrgMembership>('/org/me', { token })
}

// ---------------------------------------------------------------------------
// Messages (chat)
// ---------------------------------------------------------------------------

export interface Message {
  id: string
  match_id: string
  sender_id: string
  body: string
  created_at: string
  is_mine: boolean
}

export interface UnreadCount {
  match_id: string
  count: number
}

export function getMessages(
  token: string,
  matchId: string,
  opts?: { before?: string; limit?: number },
): Promise<Message[]> {
  const params = new URLSearchParams()
  if (opts?.before) params.set('before', opts.before)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  return request<Message[]>(`/matches/${matchId}/messages${qs ? `?${qs}` : ''}`, { token })
}

export function sendMessage(token: string, matchId: string, body: string): Promise<Message> {
  return request<Message>(`/matches/${matchId}/messages`, {
    method: 'POST',
    token,
    body: JSON.stringify({ body }),
  })
}

export function getUnreadCounts(token: string): Promise<UnreadCount[]> {
  return request<UnreadCount[]>('/matches/unread', { token })
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function getTags(category?: string, search?: string): Promise<Tag[]> {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (search) params.set('search', search)
  const qs = params.toString()
  return request<Tag[]>(`/tags${qs ? `?${qs}` : ''}`)
}

export function getTagCategories(): Promise<TagCategory[]> {
  return request<TagCategory[]>('/tags/categories')
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export function getBookmarks(token: string): Promise<BookmarkGroup[]> {
  return request<BookmarkGroup[]>('/bookmarks', { token })
}

export function addBookmark(token: string, targetId: string, note?: string): Promise<Bookmark> {
  return request<Bookmark>('/bookmarks', {
    method: 'POST',
    token,
    body: JSON.stringify({ target_id: targetId, note: note ?? '' }),
  })
}

export function moveBookmark(token: string, targetId: string, jobPostingId: string | null): Promise<Bookmark> {
  return request<Bookmark>(`/bookmarks/${targetId}/move`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ job_posting_id: jobPostingId }),
  })
}

export function updateBookmarkNote(token: string, targetId: string, note: string): Promise<Bookmark> {
  return request<Bookmark>(`/bookmarks/${targetId}/note`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ note }),
  })
}

export function removeBookmark(token: string, targetId: string): Promise<void> {
  return request<void>(`/bookmarks/${targetId}`, { method: 'DELETE', token })
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportReason = 'spam' | 'inappropriate' | 'fake' | 'harassment' | 'other'

export interface Report {
  id: string
  target_id: string
  target_type: 'user' | 'job'
  reason: ReportReason
  details: string
  status: string
  created_at: string
}

export function submitReport(
  token: string,
  targetId: string,
  targetType: 'user' | 'job',
  reason: ReportReason,
  details: string = '',
): Promise<Report> {
  return request<Report>('/reports', {
    method: 'POST',
    token,
    body: JSON.stringify({ target_id: targetId, target_type: targetType, reason, details }),
  })
}

// ---------------------------------------------------------------------------
// GDPR
// ---------------------------------------------------------------------------

export function exportMyData(token: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/account/export', { token })
}

export function deleteMyAccount(token: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>('/account/delete', { method: 'DELETE', token })
}
