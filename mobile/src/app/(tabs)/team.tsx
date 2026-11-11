import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import {
  createInvite, createOrg, getMyMembership, getMyOrg, getOrgInvites, getOrgMembers, joinOrg, removeMember,
  revokeInvite, updateMemberRole, type Org, type OrgInvite, type OrgMember, type OrgMembership,
} from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { config } from '../../lib/config'
import { Body, Button, Choice, ErrorBox, Field, Screen, Title } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'
const ASSIGNABLE = ['admin', 'manager', 'viewer'] as const

/** An invite link, or just its token: the token either way. */
function tokenFrom(text: string): string {
  const t = text.trim()
  const m = t.match(/[?&]token=([^&\s]+)/)
  return m ? decodeURIComponent(m[1]) : t
}

// Same as the web Team.tsx: members and roles, pending invites, invite by
// email with a role (shared through the phone's share sheet), change or
// remove members; without a team, create one or join with an invite.
export default function Team() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const token = session?.access_token ?? ''
  const me = session?.user.email ?? ''

  const [load, setLoad] = useState<Load>('loading')
  const [membership, setMembership] = useState<OrgMembership | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [error, setError] = useState<string | null>(null)

  const [invEmail, setInvEmail] = useState('')
  const [invRole, setInvRole] = useState<string>('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [orgName, setOrgName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)

  const fetchTeam = useCallback(async () => {
    try {
      const m = await getMyMembership(token)
      setMembership(m)
      if (m.has_org) {
        const canManage = m.role === 'owner' || m.role === 'admin'
        const [o, mem, inv] = await Promise.all([
          getMyOrg(token), getOrgMembers(token), canManage ? getOrgInvites(token) : Promise.resolve([]),
        ])
        setOrg(o)
        setMembers(mem)
        setInvites(inv)
      }
      setLoad('ready')
    } catch {
      setLoad('error')
    }
  }, [token])

  useFocusEffect(
    useCallback(() => {
      if (token) fetchTeam()
    }, [token, fetchTeam]),
  )

  const roleLabel = (role: string | null) => (role ? t(`team.roles.${role}`, { defaultValue: role }) : '')
  const canManage = membership?.role === 'owner' || membership?.role === 'admin'
  const f = fonts()

  async function invite() {
    const email = invEmail.trim()
    if (!email || inviting) return
    setInviting(true)
    setInviteError(null)
    try {
      const inv = await createInvite(token, email, invRole)
      setInvites((prev) => [inv, ...prev])
      setInvEmail('')
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : t('team.failedToSendInvite'))
    } finally {
      setInviting(false)
    }
  }

  const shareInvite = (inv: OrgInvite) =>
    Share.share({
      message: t('mobile.inviteMessage', {
        org: org?.name ?? t('team.organization'),
        link: `${config.webUrl}/join?token=${encodeURIComponent(inv.token)}`,
      }),
    }).catch(() => {})

  async function revoke(inv: OrgInvite) {
    await revokeInvite(token, inv.id).catch(() => {})
    setInvites((prev) => prev.filter((i) => i.id !== inv.id))
  }

  async function changeRole(m: OrgMember, role: string) {
    if (role === m.role) return
    setError(null)
    try {
      const updated = await updateMemberRole(token, m.id, role)
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...updated } : x)))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('team.failedToUpdateRole'))
    }
  }

  function remove(m: OrgMember) {
    Alert.alert(m.email, t('team.confirmRemove', { email: m.email }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bookmarks.remove'),
        style: 'destructive',
        onPress: async () => {
          setError(null)
          try {
            await removeMember(token, m.id)
            setMembers((prev) => prev.filter((x) => x.id !== m.id))
          } catch (err) {
            setError(err instanceof Error ? err.message : t('team.failedToRemoveMember'))
          }
        },
      },
    ])
  }

  async function createTeam() {
    if (!orgName.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await createOrg(token, orgName.trim())
      await fetchTeam()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('team.failedToCreateOrg'))
    } finally {
      setBusy(false)
    }
  }

  async function joinTeam() {
    const code = tokenFrom(joinCode)
    if (!code || busy) return
    setBusy(true)
    setError(null)
    try {
      await joinOrg(token, code)
      await fetchTeam()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('team.failedToJoin'))
    } finally {
      setBusy(false)
    }
  }

  if (load !== 'ready') {
    return (
      <Screen testID="screen-team">
        <View style={styles.center}>
          {load === 'loading' ? (
            <ActivityIndicator color={colors.brand} size="large" />
          ) : (
            <>
              <Body>{t('mobile.loadFailed')}</Body>
              <Button title={t('common.retry')} onPress={() => { setLoad('loading'); fetchTeam() }} />
            </>
          )}
        </View>
      </Screen>
    )
  }

  // No team yet: create one, or join with the invite link/code.
  if (!membership?.has_org) {
    return (
      <Screen testID="screen-team">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Ionicons name="people-outline" size={56} color={colors.brandScale[300]} style={styles.icon} />
          <Title>{t('nav.team')}</Title>
          <Body muted>{t('team.whatIsOrg')}</Body>
          <Choice
            value={mode}
            onChange={setMode}
            options={[
              { value: 'create', label: t('team.createOrganization') },
              { value: 'join', label: t('team.joinOrganization') },
            ]}
          />
          {mode === 'create' ? (
            <View style={styles.card}>
              <Body muted>{t('team.createOrgHint')}</Body>
              <Field label={t('team.organizationName')} placeholder={t('team.organizationNamePlaceholder')} value={orgName} onChangeText={setOrgName} />
              <Button title={t('team.createOrganization')} onPress={createTeam} busy={busy} disabled={!orgName.trim()} />
            </View>
          ) : (
            <View style={styles.card}>
              <Body muted>{t('team.joinOrgHint')}</Body>
              <Field
                label={t('team.inviteToken')} placeholder={t('team.inviteTokenPlaceholder')} value={joinCode}
                onChangeText={setJoinCode} autoCapitalize="none" autoCorrect={false}
              />
              <Button title={t('team.joinOrganization')} onPress={joinTeam} busy={busy} disabled={!joinCode.trim()} />
            </View>
          )}
          {error && <ErrorBox message={error} />}
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen testID="screen-team">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={[styles.heading, { fontFamily: f.display }]}>{org?.name ?? t('team.organization')}</Text>
          <Text style={[styles.muted, { fontFamily: f.regular }]}>{`${t('team.yourRole')} ${roleLabel(membership.role)}`}</Text>
        </View>
        {error && <ErrorBox message={error} />}

        <View style={styles.card}>
          <Text style={[styles.section, { fontFamily: f.semibold }]}>{t('team.membersCount', { count: members.length })}</Text>
          {members.map((m) => {
            const editable = canManage && m.role !== 'owner' && m.email !== me
            return (
              <View key={m.id} style={styles.member} testID={`member-${m.id}`}>
                <View style={styles.memberTop}>
                  <View style={styles.flex}>
                    <Text style={[styles.email, { fontFamily: f.semibold }]} numberOfLines={1}>
                      {m.email}{m.email === me ? ` (${t('common.you')})` : ''}
                    </Text>
                    {!editable && <Text style={[styles.muted, { fontFamily: f.regular }]}>{roleLabel(m.role)}</Text>}
                  </View>
                  {editable && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('mobile.removeMember', { email: m.email })}
                      onPress={() => remove(m)}
                      hitSlop={6}
                      style={styles.iconButton}
                    >
                      <Ionicons name="person-remove-outline" size={20} color={colors.danger} />
                    </Pressable>
                  )}
                </View>
                {editable && (
                  <Choice
                    value={m.role}
                    onChange={(role) => changeRole(m, role)}
                    options={ASSIGNABLE.map((r) => ({ value: r, label: roleLabel(r) }))}
                  />
                )}
              </View>
            )
          })}
        </View>

        {canManage && (
          <View style={styles.card}>
            <Text style={[styles.section, { fontFamily: f.semibold }]}>{t('team.inviteTeamMember')}</Text>
            <Field
              label={t('common.emailAddress')} placeholder={t('team.invitePlaceholder')} value={invEmail}
              onChangeText={setInvEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            />
            <View testID="invite-role" style={styles.roles}>
              <Choice value={invRole} onChange={setInvRole} options={ASSIGNABLE.map((r) => ({ value: r, label: roleLabel(r) }))} />
              <Text style={[styles.muted, { fontFamily: f.regular }]}>{t(`team.roleDescriptions.${invRole}`)}</Text>
            </View>
            {inviteError && <ErrorBox message={inviteError} />}
            <Button title={t('team.invite')} onPress={invite} busy={inviting} disabled={!invEmail.trim()} />
          </View>
        )}

        {canManage && invites.length > 0 && (
          <View style={styles.card}>
            <Text style={[styles.section, { fontFamily: f.semibold }]}>{t('team.pendingInvites', { count: invites.length })}</Text>
            {invites.map((inv) => (
              <View key={inv.id} style={styles.invite}>
                <View style={styles.flex}>
                  <Text style={[styles.email, { fontFamily: f.semibold }]} numberOfLines={1}>{inv.email}</Text>
                  <Text style={[styles.muted, { fontFamily: f.regular }]}>
                    {t('team.inviteExpiresLabel', {
                      role: roleLabel(inv.role),
                      date: new Date(inv.expires_at).toLocaleDateString(i18n.resolvedLanguage ?? 'en'),
                    })}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.shareInviteFor', { email: inv.email })}
                  onPress={() => shareInvite(inv)}
                  hitSlop={6}
                  style={styles.iconButton}
                >
                  <Ionicons name="share-social-outline" size={22} color={colors.brand} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.revokeInviteFor', { email: inv.email })}
                  onPress={() => revoke(inv)}
                  hitSlop={6}
                  style={styles.iconButton}
                >
                  <Ionicons name="close-circle-outline" size={22} color={colors.gray[500]} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  icon: { alignSelf: 'center' },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  heading: { fontSize: 26, color: colors.ink, textAlign: 'left' },
  muted: { fontSize: 13, color: colors.muted, textAlign: 'left' },
  card: { gap: space.md, padding: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  section: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  member: { gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  email: { fontSize: 15, color: colors.ink, textAlign: 'left' },
  roles: { gap: space.xs },
  invite: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: colors.border },
  iconButton: { width: TOUCH - 8, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
})
