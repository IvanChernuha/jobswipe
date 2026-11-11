import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import {
  getBookmarks, getJobPostings, getMyMembership, moveBookmark, postSwipe, removeBookmark, type BookmarkGroup, type SavedItem,
} from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { salaryRange } from '../../lib/cards'
import { haptic } from '../../lib/haptics'
import Avatar from '../../components/Avatar'
import JobPicker, { type PickJob } from '../../components/JobPicker'
import MatchModal from '../../components/MatchModal'
import { Body, Button, Screen, Title } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'
type IconName = keyof typeof Ionicons.glyphMap

function Action({ icon, label, color, onPress }: { icon: IconName; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  )
}

// Same as the web Bookmarks.tsx (notes come later): saved jobs for workers,
// saved candidates by job for employers, who can move them between jobs.
export default function Saved() {
  const { t } = useTranslation()
  const router = useRouter()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''
  const employer = role === 'employer'

  const [groups, setGroups] = useState<BookmarkGroup[]>([])
  const [load, setLoad] = useState<Load>('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [canLike, setCanLike] = useState(true)
  const [newMatch, setNewMatch] = useState<{ id: string | null; name: string } | null>(null)
  // Employers: the candidate being moved to another job, and the jobs to pick from.
  const [moving, setMoving] = useState<{ item: SavedItem; name: string } | null>(null)
  const [jobs, setJobs] = useState<PickJob[]>([])

  const fetchSaved = useCallback(async () => {
    try {
      setGroups(await getBookmarks(token))
      setLoad('ready')
    } catch {
      setLoad('error')
    }
  }, [token])

  // Reload whenever the tab is opened: things saved in the feed show up.
  useFocusEffect(
    useCallback(() => {
      if (token) fetchSaved()
    }, [token, fetchSaved]),
  )

  useEffect(() => {
    if (!token || !employer) return
    getMyMembership(token)
      .then((m) => setCanLike(!(m.has_org && m.role === 'viewer')))
      .catch(() => {})
  }, [token, employer])

  function drop(targetId: string) {
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, bookmarks: g.bookmarks.filter((b) => b.target_id !== targetId) }))
        .filter((g) => g.bookmarks.length > 0),
    )
  }

  async function remove(item: SavedItem) {
    drop(item.target_id)
    await removeBookmark(token, item.target_id).catch(() => {})
  }

  async function swipe(item: SavedItem, direction: 'like' | 'pass', name: string) {
    if (direction === 'like') haptic.tap()
    try {
      const res = await postSwipe(token, { target_id: item.target_id, direction })
      if (res.matched) {
        haptic.success()
        setNewMatch({ id: res.match_id, name })
      }
    } catch {
      // Already swiped from elsewhere: just tidy the list.
    }
    drop(item.target_id)
    await removeBookmark(token, item.target_id).catch(() => {})
  }

  async function startMove(item: SavedItem, name: string) {
    if (jobs.length === 0) {
      const mine = await getJobPostings(token).catch(() => [])
      setJobs([...mine.map((j) => ({ id: j.id, title: j.title })), { id: null, title: t('bookmarks.unsorted') }])
    }
    setMoving({ item, name })
  }

  async function moveTo(job: PickJob) {
    const item = moving?.item
    setMoving(null)
    if (!item) return
    await moveBookmark(token, item.target_id, job.id).catch(() => {})
    await fetchSaved()
  }

  const retry = () => {
    setLoad('loading')
    fetchSaved()
  }
  const refresh = async () => {
    setRefreshing(true)
    await fetchSaved()
    setRefreshing(false)
  }

  const f = fonts()
  const count = groups.reduce((n, g) => n + g.bookmarks.length, 0)
  const sections = groups.map((g) => ({
    key: g.job_posting_id ?? 'none',
    title: g.job_posting_id ? g.job_title : t('bookmarks.unsorted'),
    data: g.bookmarks,
  }))

  const modal = (
    <MatchModal
      name={newMatch?.name ?? null}
      onClose={() => setNewMatch(null)}
      onChat={() => {
        const id = newMatch?.id
        setNewMatch(null)
        router.navigate(id ? `/chat/${id}` : '/matches')
      }}
    />
  )

  if (load !== 'ready' || count === 0) {
    return (
      <Screen testID="screen-saved">
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
              <Ionicons name="bookmark-outline" size={56} color={colors.brandScale[300]} style={styles.icon} />
              <Title>{t('bookmarks.emptyTitle')}</Title>
              <Body muted>{t('mobile.savedHint')}</Body>
              <Button title={t('mobile.refresh')} variant="secondary" onPress={retry} />
            </>
          )}
        </View>
        {modal}
      </Screen>
    )
  }

  return (
    <Screen testID="screen-saved">
      <SectionList
        sections={sections}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.brand]} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={[styles.heading, { fontFamily: f.display }]}>{t('nav.saved')}</Text>
            <Text style={[styles.count, { fontFamily: f.regular }]}>{t('bookmarks.savedCount', { count })}</Text>
          </View>
        }
        // Workers have one group ("All Saved"); headers only make sense for employers.
        renderSectionHeader={({ section }) =>
          employer ? <Text style={[styles.section, { fontFamily: f.semibold }]}>{section.title}</Text> : null
        }
        renderItem={({ item: b }) => {
          const name = employer ? b.name ?? t('bookmarks.unknownWorker') : b.company_name ?? ''
          const headline = employer ? name : b.job_title ?? t('bookmarks.untitledJob')
          const subtitle = employer
            ? [b.experience_years != null ? t('bookmarks.yearsExperience', { count: b.experience_years }) : null, b.location]
              .filter(Boolean).join(' · ')
            : [b.company_name, b.location].filter(Boolean).join(' · ')
          const salary = employer ? null : salaryRange(b.salary_min, b.salary_max)
          return (
            <View style={styles.row} testID={`saved-${b.target_id}`}>
              <Avatar name={name || headline} url={b.avatar_url} size={48} />
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t('mobile.viewProfile')}
                onPress={() => router.push(`/saved/${b.target_id}`)}
                style={({ pressed }) => [styles.info, pressed && styles.infoPressed]}
              >
                <Text style={[styles.title, { fontFamily: f.semibold }]} numberOfLines={2}>{headline}</Text>
                {!!subtitle && <Text style={[styles.sub, { fontFamily: f.regular }]} numberOfLines={1}>{subtitle}</Text>}
                {!!salary && <Text style={[styles.salary, { fontFamily: f.medium }]}>{salary}</Text>}
              </Pressable>
              <View style={styles.actions}>
                {employer && (
                  <Action icon="swap-horizontal" label={t('mobile.moveNamed', { name })} color={colors.gray[600]} onPress={() => startMove(b, name)} />
                )}
                <Action icon="close" label={t('feed.pass')} color={colors.danger} onPress={() => swipe(b, 'pass', headline)} />
                {canLike && (
                  <Action icon="heart" label={t('feed.like')} color={colors.brand} onPress={() => swipe(b, 'like', employer ? name : b.company_name ?? headline)} />
                )}
                <Action icon="trash-outline" label={t('bookmarks.remove')} color={colors.gray[500]} onPress={() => remove(b)} />
              </View>
            </View>
          )
        }}
      />
      {modal}
      <JobPicker
        title={moving ? t('mobile.moveNamed', { name: moving.name }) : null}
        jobs={jobs}
        current={moving?.item.job_posting_id ?? null}
        onPick={moveTo}
        onClose={() => setMoving(null)}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  icon: { alignSelf: 'center' },
  list: { padding: space.lg, gap: space.md },
  headerBlock: { marginBottom: space.sm },
  heading: { fontSize: 26, color: colors.ink, textAlign: 'left' },
  count: { fontSize: 14, color: colors.muted, textAlign: 'left' },
  section: { fontSize: 13, color: colors.gray[600], textTransform: 'uppercase', marginTop: space.md, textAlign: 'left' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  info: { flex: 1, gap: 2 },
  infoPressed: { opacity: 0.6 },
  title: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  sub: { fontSize: 13, color: colors.gray[600], textAlign: 'left' },
  salary: { fontSize: 13, color: colors.brandDark, textAlign: 'left' },
  actions: { flexDirection: 'row', gap: 2 },
  action: { width: TOUCH - 8, height: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  pressed: { backgroundColor: colors.gray[100] },
})
