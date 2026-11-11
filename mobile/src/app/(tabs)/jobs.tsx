import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { deleteJobPosting, getJobPostings, toggleJobActive, type JobPosting } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { salaryRange } from '../../lib/cards'
import { Body, Button, ErrorBox, Screen, Title } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'
type Status = 'active' | 'expired' | 'inactive'

const statusOf = (j: JobPosting): Status =>
  !j.active ? 'inactive' : new Date(j.expires_at).getTime() < Date.now() ? 'expired' : 'active'
const ORDER: Record<Status, number> = { active: 0, expired: 1, inactive: 2 }

// Same as the web Jobs.tsx (file upload/AI parsing and extending come later):
// every job with its status and numbers, post/edit, switch off/on, delete.
export default function Jobs() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const { session } = useAuth()
  const token = session?.access_token ?? ''

  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [load, setLoad] = useState<Load>('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      setJobs(await getJobPostings(token))
      setLoad('ready')
    } catch {
      setLoad('error')
    }
  }, [token])

  // Reload whenever the tab is opened, e.g. after posting or editing a job.
  useFocusEffect(
    useCallback(() => {
      if (token) fetchJobs()
    }, [token, fetchJobs]),
  )

  const retry = () => {
    setLoad('loading')
    fetchJobs()
  }
  const refresh = async () => {
    setRefreshing(true)
    await fetchJobs()
    setRefreshing(false)
  }

  async function toggle(job: JobPosting) {
    setActionError(null)
    try {
      const updated = await toggleJobActive(token, job.id)
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...updated } : j)))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('jobs.couldNotUpdate'))
    }
  }

  function confirmDelete(job: JobPosting) {
    Alert.alert(job.title, t('jobs.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setActionError(null)
          try {
            await deleteJobPosting(token, job.id)
            setJobs((prev) => prev.filter((j) => j.id !== job.id))
          } catch (err) {
            setActionError(err instanceof Error ? err.message : t('jobs.couldNotDelete'))
          }
        },
      },
    ])
  }

  const f = fonts()
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage ?? 'en', { month: 'short', day: 'numeric' })
  const newJob = () => router.push('/job/new')

  if (load !== 'ready' || jobs.length === 0) {
    return (
      <Screen testID="screen-jobs">
        <View style={styles.center}>
          {load === 'loading' && <ActivityIndicator color={colors.brand} size="large" />}
          {load === 'error' && (
            <>
              <Body>{t('mobile.loadFailed')}</Body>
              <Button title={t('common.retry')} onPress={retry} />
            </>
          )}
          {load === 'ready' && (
            <>
              <Ionicons name="briefcase-outline" size={56} color={colors.brandScale[300]} style={styles.icon} />
              <Title>{t('jobs.emptyTitle')}</Title>
              <Body muted>{t('jobs.emptyHint')}</Body>
              <Button title={t('jobs.createJob')} onPress={newJob} />
            </>
          )}
        </View>
      </Screen>
    )
  }

  const sorted = [...jobs].sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)])

  return (
    <Screen testID="screen-jobs">
      <FlatList
        data={sorted}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} />}
        ListHeaderComponent={
          <View style={styles.top}>
            <View style={styles.flex}>
              <Text style={[styles.heading, { fontFamily: f.display }]}>{t('jobs.yourJobs')}</Text>
              <Text style={[styles.count, { fontFamily: f.regular }]}>{t('jobs.postingCount', { count: jobs.length })}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('jobs.newJob')}
              onPress={newJob}
              style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={[styles.newText, { fontFamily: f.semibold }]}>{t('jobs.newJob')}</Text>
            </Pressable>
            {actionError && <View style={styles.fullWidth}><ErrorBox message={actionError} /></View>}
          </View>
        }
        renderItem={({ item: j }) => {
          const status = statusOf(j)
          const mustHave = (j.tags ?? []).filter((s) => s.requirement === 'required')
          const salary = salaryRange(j.salary_min, j.salary_max)
          const meta = [j.remote ? t('bookmarks.remote') : j.location, salary].filter(Boolean).join(' · ')
          return (
            <View style={[styles.card, status !== 'active' && styles.cardOff]} testID={`job-${j.id}`}>
              <Pressable accessibilityRole="button" onPress={() => router.push(`/job/${j.id}`)} style={styles.cardTop}>
                <View style={styles.flex}>
                  <Text style={[styles.title, { fontFamily: f.semibold }]} numberOfLines={2}>{j.title}</Text>
                  {!!meta && <Text style={[styles.meta, { fontFamily: f.regular }]} numberOfLines={1}>{meta}</Text>}
                  <Text style={[styles.date, { fontFamily: f.regular }]}>
                    {status === 'expired'
                      ? t('jobs.expiredOn', { date: date(j.expires_at) })
                      : t('jobs.expiresOn', { date: date(j.expires_at) })}
                  </Text>
                </View>
                <View style={[styles.pill, styles[status]]}>
                  <Text style={[styles.pillText, styles[`${status}Text`], { fontFamily: f.semibold }]}>
                    {status === 'active' ? t('mobile.active') : status === 'expired' ? t('jobs.expired') : t('jobs.inactive')}
                  </Text>
                </View>
              </Pressable>

              {mustHave.length > 0 && (
                <View style={styles.tags}>
                  {mustHave.map((s) => (
                    <View key={s.id} style={styles.tag}>
                      <Text style={[styles.tagText, { fontFamily: f.medium }]}>{s.name}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.stats}>
                {([
                  [t('jobs.views'), j.swipe_count, colors.ink],
                  // like_count includes super likes; show them apart.
                  [t('jobs.likes'), (j.like_count ?? 0) - (j.super_like_count ?? 0), '#E0457B'],
                  [t('mobile.superLikes'), j.super_like_count ?? 0, '#2F6FD6'],
                  [t('jobs.matches'), j.match_count, colors.brand],
                ] as const).map(([label, value, color]) => (
                  <View key={label} style={styles.stat} accessible accessibilityLabel={`${label}: ${value ?? 0}`}>
                    <Text style={[styles.statValue, { fontFamily: f.semibold, color }]}>{value ?? 0}</Text>
                    <Text style={[styles.statLabel, { fontFamily: f.regular }]} numberOfLines={1}>{label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={j.active ? t('jobs.deactivate') : t('jobs.reactivate')}
                  onPress={() => toggle(j)}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                >
                  <Ionicons name={j.active ? 'pause-circle-outline' : 'play-circle-outline'} size={18} color={colors.gray[700]} />
                  <Text style={[styles.actionText, { fontFamily: f.medium }]}>{j.active ? t('jobs.deactivate') : t('jobs.reactivate')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                  onPress={() => confirmDelete(j)}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  <Text style={[styles.actionText, styles.danger, { fontFamily: f.medium }]}>{t('common.delete')}</Text>
                </Pressable>
              </View>
            </View>
          )
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  icon: { alignSelf: 'center' },
  list: { padding: space.lg, gap: space.md },
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  fullWidth: { width: '100%' },
  heading: { fontSize: 26, color: colors.ink, textAlign: 'left' },
  count: { fontSize: 14, color: colors.muted, textAlign: 'left' },
  newButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TOUCH, paddingHorizontal: space.lg,
    borderRadius: radius.full, backgroundColor: colors.brand,
  },
  newText: { color: '#fff', fontSize: 15 },
  pressed: { opacity: 0.7 },
  card: { padding: space.lg, gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  cardOff: { backgroundColor: colors.ground },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  title: { fontSize: 17, color: colors.ink, textAlign: 'left' },
  meta: { fontSize: 14, color: colors.gray[600], textAlign: 'left', marginTop: 2 },
  date: { fontSize: 12, color: colors.gray[400], textAlign: 'left', marginTop: 2 },
  pill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.full },
  pillText: { fontSize: 12 },
  active: { backgroundColor: colors.brandScale[50] },
  activeText: { color: colors.brandDark },
  expired: { backgroundColor: '#FFF7E6' },
  expiredText: { color: '#B7791F' },
  inactive: { backgroundColor: colors.gray[100] },
  inactiveText: { color: colors.gray[600] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.gray[100] },
  tagText: { fontSize: 12, color: colors.gray[700] },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.ground },
  statValue: { fontSize: 18, color: colors.ink },
  statLabel: { fontSize: 12, color: colors.muted },
  actions: { flexDirection: 'row', gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH - 8, paddingHorizontal: space.md, borderRadius: radius.md },
  actionText: { fontSize: 14, color: colors.gray[700] },
  danger: { color: colors.danger },
})
