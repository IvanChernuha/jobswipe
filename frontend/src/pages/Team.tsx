import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import {
  getMyOrg, createOrg, getOrgMembers, getOrgInvites,
  createInvite, revokeInvite, updateMemberRole, removeMember,
  getMyMembership, joinOrg,
  type Org, type OrgMember, type OrgInvite, type OrgMembership,
} from '../lib/api'

const ROLE_LABEL_KEYS: Record<string, string> = {
  owner: 'team.roles.owner',
  admin: 'team.roles.admin',
  manager: 'team.roles.manager',
  viewer: 'team.roles.viewer',
}

const ROLE_DESCRIPTION_KEYS: Record<string, string> = {
  owner: 'team.roleDescriptions.owner',
  admin: 'team.roleDescriptions.admin',
  manager: 'team.roleDescriptions.manager',
  viewer: 'team.roleDescriptions.viewer',
}

const ASSIGNABLE_ROLES = ['admin', 'manager', 'viewer']

export default function Team() {
  const { t, i18n } = useTranslation()
  const { session, user } = useAuth()
  const token = session?.access_token ?? ''

  const [membership, setMembership] = useState<OrgMembership | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create org form
  const [orgName, setOrgName] = useState('')
  const [creating, setCreating] = useState(false)

  // Invite form
  const [invEmail, setInvEmail] = useState('')
  const [invRole, setInvRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Join org
  const [joinToken, setJoinToken] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!token) return
    loadData()
  }, [token])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const m = await getMyMembership(token)
      setMembership(m)
      if (m.has_org) {
        const [o, mem, inv] = await Promise.all([
          getMyOrg(token),
          getOrgMembers(token),
          m.role === 'owner' || m.role === 'admin' ? getOrgInvites(token) : Promise.resolve([]),
        ])
        setOrg(o)
        setMembers(mem)
        setInvites(inv)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('team.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault()
    if (!orgName.trim()) return
    setCreating(true)
    try {
      await createOrg(token, orgName.trim())
      await loadData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('team.failedToCreateOrg'))
    } finally {
      setCreating(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    if (!invEmail.trim()) return
    setInviting(true)
    try {
      const inv = await createInvite(token, invEmail.trim(), invRole)
      setInvites((prev) => [inv, ...prev])
      setInvEmail('')
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : t('team.failedToSendInvite'))
    } finally {
      setInviting(false)
    }
  }

  async function handleRevoke(inviteId: string) {
    try {
      await revokeInvite(token, inviteId)
      setInvites((prev) => prev.filter((i) => i.id !== inviteId))
    } catch { /* silent */ }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    try {
      const updated = await updateMemberRole(token, memberId, newRole)
      setMembers((prev) => prev.map((m) => (m.id === memberId ? updated : m)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('team.failedToUpdateRole'))
    }
  }

  async function handleRemove(memberId: string, email: string) {
    if (!confirm(t('team.confirmRemove', { email }))) return
    try {
      await removeMember(token, memberId)
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('team.failedToRemoveMember'))
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!joinToken.trim()) return
    setJoining(true)
    try {
      await joinOrg(token, joinToken.trim())
      await loadData()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('team.failedToJoin'))
    } finally {
      setJoining(false)
    }
  }

  const canManage = membership?.role === 'owner' || membership?.role === 'admin'

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        </div>
      </Shell>
    )
  }

  // No org yet — show create/join toggle
  if (!membership?.has_org) {
    return <NoOrgView
      error={error}
      onDismissError={() => setError(null)}
      orgName={orgName}
      onOrgNameChange={setOrgName}
      creating={creating}
      onCreateOrg={handleCreateOrg}
      joinToken={joinToken}
      onJoinTokenChange={setJoinToken}
      joining={joining}
      onJoin={handleJoin}
    />
  }

  // Has org — show management
  return (
    <Shell>
      <div className="max-w-3xl w-full px-4 py-8">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{org?.name ?? t('team.organization')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('team.yourRole')} <span className="font-medium text-gray-700">{membership.role && ROLE_LABEL_KEYS[membership.role] ? t(ROLE_LABEL_KEYS[membership.role]) : membership.role}</span>
          </p>
        </div>

        {/* Members */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {t('team.membersCount', { count: members.length })}
          </h2>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-white">
                    {m.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.email}</p>
                  <p className="text-xs text-gray-400">{ROLE_DESCRIPTION_KEYS[m.role] ? t(ROLE_DESCRIPTION_KEYS[m.role]) : m.role}</p>
                </div>

                {/* Role selector (only for admins+ and not for self or owner) */}
                {canManage && m.role !== 'owner' && m.user_id !== user?.id ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>{t(ROLE_LABEL_KEYS[r])}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleRemove(m.id, m.email)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      {t('bookmarks.remove')}
                    </button>
                  </div>
                ) : (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    m.role === 'owner' ? 'bg-purple-50 text-purple-600' :
                    m.role === 'admin' ? 'bg-blue-50 text-blue-600' :
                    m.role === 'manager' ? 'bg-green-50 text-green-600' :
                    'bg-gray-50 text-gray-600'
                  }`}>
                    {t(ROLE_LABEL_KEYS[m.role])}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Invite section (admins+ only) */}
        {canManage && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {t('team.inviteTeamMember')}
            </h2>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              {inviteError && (
                <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{inviteError}</div>
              )}
              <form onSubmit={handleInvite} className="flex gap-2">
                <input
                  required
                  type="email"
                  placeholder={t('team.invitePlaceholder')}
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  className="input flex-1"
                />
                <select
                  value={invRole}
                  onChange={(e) => setInvRole(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-300"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{t(ROLE_LABEL_KEYS[r])}</option>
                  ))}
                </select>
                <button type="submit" disabled={inviting} className="btn-primary text-sm px-4">
                  {inviting ? '...' : t('team.invite')}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Pending invites */}
        {canManage && invites.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {t('team.pendingInvites', { count: invites.length })}
            </h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div key={inv.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                    <p className="text-xs text-gray-400">
                      {t('team.inviteExpiresLabel', { role: t(ROLE_LABEL_KEYS[inv.role]), date: new Date(inv.expires_at).toLocaleDateString(i18n.language) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const link = `${window.location.origin}/join?token=${inv.token}`
                        navigator.clipboard.writeText(link)
                        alert(t('team.inviteLinkCopied'))
                      }}
                      className="text-xs text-brand-600 hover:text-brand-700 px-2 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
                    >
                      {t('team.copyLink')}
                    </button>
                    <button
                      onClick={() => handleRevoke(inv.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      {t('team.revoke')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

function NoOrgView({
  error, onDismissError,
  orgName, onOrgNameChange, creating, onCreateOrg,
  joinToken, onJoinTokenChange, joining, onJoin,
}: {
  error: string | null
  onDismissError: () => void
  orgName: string
  onOrgNameChange: (v: string) => void
  creating: boolean
  onCreateOrg: (e: React.FormEvent) => void
  joinToken: string
  onJoinTokenChange: (v: string) => void
  joining: boolean
  onJoin: (e: React.FormEvent) => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'create' | 'join'>('create')

  return (
    <Shell>
      <div className="max-w-md w-full px-4 py-16">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">👥</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.team')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('team.collaborateHint')}</p>
        </div>

        {error && <ErrorBanner message={error} onDismiss={onDismissError} />}

        {/* Toggle switch */}
        <div className="bg-gray-100 rounded-xl p-1 flex mb-6">
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
              tab === 'create'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('team.createOrganization')}
          </button>
          <button
            onClick={() => setTab('join')}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
              tab === 'join'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('team.joinOrganization')}
          </button>
        </div>

        {/* Create tab */}
        {tab === 'create' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-fade-in">
            <p className="text-sm text-gray-500 mb-4">
              {t('team.createOrgHint')}
            </p>
            <form onSubmit={onCreateOrg} className="space-y-4">
              <div>
                <label className="label">{t('team.organizationName')}</label>
                <input
                  required
                  className="input"
                  placeholder={t('team.organizationNamePlaceholder')}
                  value={orgName}
                  onChange={(e) => onOrgNameChange(e.target.value)}
                />
              </div>
              <button type="submit" disabled={creating} className="btn-primary w-full py-2.5 text-sm">
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('team.creatingEllipsis')}
                  </span>
                ) : (
                  t('team.createOrganization')
                )}
              </button>
            </form>
          </div>
        )}

        {/* Join tab */}
        {tab === 'join' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-fade-in">
            <p className="text-sm text-gray-500 mb-4">
              {t('team.joinOrgHint')}
            </p>
            <form onSubmit={onJoin} className="space-y-4">
              <div>
                <label className="label">{t('team.inviteToken')}</label>
                <input
                  required
                  className="input"
                  placeholder={t('team.inviteTokenPlaceholder')}
                  value={joinToken}
                  onChange={(e) => onJoinTokenChange(e.target.value)}
                />
              </div>
              <button type="submit" disabled={joining} className="btn-primary w-full py-2.5 text-sm">
                {joining ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('team.joiningEllipsis')}
                  </span>
                ) : (
                  t('team.joinOrganization')
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center">
      {children}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
      <span className="text-sm text-red-700">{message}</span>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600 ms-2">✕</button>
    </div>
  )
}
