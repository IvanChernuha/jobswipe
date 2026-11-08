import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, I18nManager, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { getJobPostings, getMatches, getUnreadCounts, type Match } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { groupByJob, otherSide, type JobGroup } from '../../lib/matches'
import Avatar from '../../components/Avatar'
import { Body, Button, Screen, Title } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'

// Same as the web Matches.tsx: one row per match, unread count, tap to chat.
// Employers see them grouped under the job each match came from.
export default function Matches() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''
  const worker = role !== 'employer'

  const [matches, setMatches] = useState<Match[]>([])
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [load, setLoad] = useState<Load>('loading')
  const [refreshing, setRefreshing] = useState(false)

  const fetchMatches = useCallback(async () => {
    try {
      const [m, counts, myJobs] = await Promise.all([
        getMatches(token),
        getUnreadCounts(token).catch(() => []),
        worker ? Promise.resolve([]) : getJobPostings(token).catch(() => []),
      ])
      setMatches(m)
      setJobs(myJobs)
      setUnread(Object.fromEntries(counts.map((c) => [c.match_id, c.count])))
      setLoad('ready')
    } catch {
      setLoad('error')
    }
  }, [token, worker])

  // Reload whenever the tab is opened: new matches and read messages show up.
  useFocusEffect(
    useCallback(() => {
      if (token) fetchMatches()
    }, [token, fetchMatches]),
  )

  const retry = () => {
    setLoad('loading')
    fetchMatches()
  }
  const refresh = async () => {
    setRefreshing(true)
    await fetchMatches()
    setRefreshing(false)
  }

  const f = fonts()
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage ?? 'en', { month: 'short', day: 'numeric' })

  const row = (m: Match) => {
    const other = otherSide(m, worker, t)
    const count = unread[m.id] ?? 0
    const subtitle = worker
      ? m.employer?.job_title ?? ''
      : m.worker?.experience_years != null ? t('matches.yrsExp', { count: m.worker.experience_years }) : ''
    return (
      <Pressable
        key={m.id}
        accessibilityRole="button"
        onPress={() => router.push(`/chat/${m.id}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View>
          <Avatar name={other.name} url={other.avatar} />
          {count > 0 && (
            <View style={styles.badge} accessibilityLabel={t('mobile.unread', { count })}>
              <Text style={[styles.badgeText, { fontFamily: f.semibold }]}>{count > 9 ? '9+' : count}</Text>
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { fontFamily: f.semibold }]} numberOfLines={1}>{other.name}</Text>
          {!!subtitle && <Text style={[styles.sub, { fontFamily: f.regular }]} numberOfLines={1}>{subtitle}</Text>}
          <Text style={[styles.date, { fontFamily: f.regular }]}>{t('matches.matchedOn', { date: date(m.matched_at) })}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.gray[400]} style={styles.chevron} />
      </Pressable>
    )
  }

  const group = (g: JobGroup) => (
    <View style={styles.group} testID={`matches-job-${g.key}`}>
      <View style={styles.groupHead}>
        <Ionicons name="briefcase-outline" size={16} color={colors.gray[500]} />
        <Text style={[styles.groupTitle, { fontFamily: f.semibold }]} numberOfLines={1}>
          {g.title ?? t('mobile.otherMatches')}
        </Text>
        <Text style={[styles.groupCount, { fontFamily: f.regular }]}>{t('mobile.matchCount', { count: g.matches.length })}</Text>
      </View>
      {g.matches.map(row)}
    </View>
  )

  if (load !== 'ready' || matches.length === 0) {
    return (
      <Screen testID="screen-matches">
        <View style={styles.center}>
          {load === 'loading' && <ActivityIndicator color={colors.brand} size="large" />}
          {load === 'error' && (
            <>
              <Title>{t('matches.failedToLoad')}</Title>
              <Button title={t('common.retry')} onPress={retry} />
            </>
          )}
          {load === 'ready' && (
            <>
              <Ionicons name="chatbubbles-outline" size={56} color={colors.brandScale[300]} style={styles.icon} />
              <Title>{t('matches.emptyTitle')}</Title>
              <Body muted>{t('matches.emptyHint')}</Body>
              <Button title={t('mobile.refresh')} variant="secondary" onPress={retry} />
            </>
          )}
        </View>
      </Screen>
    )
  }

  return (
    <Screen testID="screen-matches">
      <FlatList<Match | JobGroup>
        data={worker ? matches : groupByJob(matches, jobs)}
        keyExtractor={(item) => ('matches' in item ? item.key : item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} />}
        ListHeaderComponent={
          <Text style={[styles.heading, { fontFamily: f.display }]}>
            {t('matches.yourMatches')} <Text style={styles.headingCount}>({matches.length})</Text>
          </Text>
        }
        renderItem={({ item }) => ('matches' in item ? group(item) : row(item))}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  icon: { alignSelf: 'center' },
  list: { padding: space.lg, gap: space.md },
  heading: { fontSize: 26, color: colors.ink, marginBottom: space.sm },
  headingCount: { fontSize: 18, color: colors.brand },
  row: {
    minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  badge: {
    position: 'absolute', top: -4, end: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 4,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  badgeText: { color: '#fff', fontSize: 11 },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  sub: { fontSize: 14, color: colors.gray[600], textAlign: 'left' },
  date: { fontSize: 12, color: colors.gray[400], textAlign: 'left' },
  group: { gap: space.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  groupTitle: { flex: 1, fontSize: 15, color: colors.gray[700], textAlign: 'left' },
  groupCount: { fontSize: 13, color: colors.muted },
  chevron: { transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] },
})
