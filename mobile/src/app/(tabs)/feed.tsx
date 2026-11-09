import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { deck, type DeckState, type SwipeKind } from '@jobswipe/shared/feed'
import {
  addBookmark, getEmployerFeed, getJobPostings, getMyMembership, getWorkerFeed, postSwipe, removeBookmark, undoLastSwipe,
} from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { haptic } from '../../lib/haptics'
import { candidateToCard, jobToCard, type CardData } from '../../lib/cards'
import SwipeDeck, { type DeckHandle } from '../../components/SwipeDeck'
import JobSwitcher from '../../components/JobSwitcher'
import MatchModal from '../../components/MatchModal'
import RoundButton from '../../components/RoundButton'
import { Body, Button, Screen, Title } from '../../components/ui'
import { colors, fonts, space } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'

export default function Feed() {
  const { t } = useTranslation()
  const router = useRouter()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''
  const employer = role === 'employer'

  const [state, setState] = useState<DeckState<CardData>>(deck.initial)
  const [load, setLoad] = useState<Load>('loading')
  const [newMatch, setNewMatch] = useState<{ id: string | null; name: string } | null>(null)
  const [canLike, setCanLike] = useState(true)
  // Employers: their live jobs, and the one the feed is showing (null = all).
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  // A card coming back after undo flies in from where it left.
  const [returning, setReturning] = useState<{ id: string; kind: SwipeKind | 'bookmark' } | null>(null)
  const deckRef = useRef<DeckHandle>(null)
  // Guards against a second tap before the first swipe's request returns.
  const busy = useRef(false)

  const fetchCards = useCallback(async () => {
    setLoad('loading')
    try {
      const cards = !employer
        ? (await getWorkerFeed(token)).map(jobToCard)
        : (await (jobId ? getEmployerFeed(token, { job_id: jobId }) : getEmployerFeed(token))).map(candidateToCard)
      setState((s) => deck.loaded(s, cards))
      setLoad('ready')
    } catch {
      setLoad('error')
    }
  }, [employer, token, jobId])

  useEffect(() => {
    if (token) fetchCards()
  }, [token, fetchCards])

  // Team members with the viewer role can look but not like (same as web).
  useEffect(() => {
    if (!token || !employer) return
    getMyMembership(token)
      .then((m) => setCanLike(!(m.has_org && m.role === 'viewer')))
      .catch(() => {})
    const now = Date.now()
    getJobPostings(token)
      .then((all) => setJobs(all.filter((j) => j.active && new Date(j.expires_at).getTime() >= now)))
      .catch(() => {})
  }, [token, employer])

  async function act(fn: (card: CardData) => Promise<DeckState<CardData> | null>) {
    const card = deck.top(state)
    if (busy.current || !card) return
    busy.current = true
    setReturning(null)
    try {
      const next = await fn(card)
      if (next) setState(next)
    } finally {
      busy.current = false
    }
  }

  /** `dragged`: the finger already threw the card; buttons animate it here. */
  const swipe = (kind: SwipeKind, dragged = false) =>
    act(async (card) => {
      if (kind !== 'pass') haptic.tap()
      if (!dragged) await deckRef.current?.fling(kind)
      try {
        const res = await postSwipe(token, { target_id: card.id, direction: kind })
        if (res.matched) {
          haptic.success()
          setNewMatch({ id: res.match_id, name: card.name })
        }
      } catch {
        // Like the web: a failed swipe is not fatal, keep going.
      }
      return deck.swiped(state, kind)
    })

  const bookmark = () =>
    act(async (card) => {
      await deckRef.current?.fling('bookmark')
      await addBookmark(token, card.id).catch(() => {})
      return deck.bookmarked(state)
    })

  const undo = () => {
    if (busy.current || !deck.canUndo(state)) return
    const last = state.last!
    busy.current = true
    const done = (ok: boolean) => {
      if (ok) {
        setReturning({ id: last.card.id, kind: last.kind })
        setState((s) => deck.undone(s))
      }
      busy.current = false
    }
    if (last.kind === 'bookmark') {
      removeBookmark(token, last.card.id).catch(() => {}).finally(() => done(true))
    } else {
      undoLastSwipe(token).then((r) => done(r.undone)).catch(() => done(false))
    }
  }

  const top = deck.top(state)
  const f = fonts()

  return (
    <Screen testID="screen-feed">
      <View style={styles.header}>
        <Text style={[styles.brand, { fontFamily: f.display }]}>JobSwipe</Text>
        {top && (
          <Text style={[styles.count, { fontFamily: f.regular }]}>
            {t('feed.remaining', { count: deck.remaining(state) })}
          </Text>
        )}
      </View>

      {employer && jobs.length > 0 && (
        <View style={styles.switcher}>
          <JobSwitcher jobs={jobs} selected={jobId} onSelect={setJobId} />
        </View>
      )}

      <View style={styles.deckArea}>
        {load === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} size="large" />
            <Body muted>{t('feed.findingProfiles')}</Body>
          </View>
        )}
        {load === 'error' && (
          <View style={styles.center}>
            <Title>{t('feed.failedToLoad')}</Title>
            <Button title={t('common.retry')} onPress={fetchCards} />
          </View>
        )}
        {load === 'ready' && !top && (
          <View style={styles.center}>
            <Title>{t('feed.emptyAllCaughtUp')}</Title>
            <Body muted>
              {t('feed.emptyNoMoreProfiles', { role: employer ? t('swipeCard.candidate') : t('swipeCard.job') })}
            </Body>
            <Button title={t('mobile.refresh')} variant="secondary" onPress={fetchCards} />
          </View>
        )}
        {load === 'ready' && top && (
          <SwipeDeck
            ref={deckRef}
            top={top}
            next={state.cards[1] ?? null}
            enabled={canLike}
            returning={returning}
            onSwipe={(dir) => swipe(dir, true)}
          />
        )}
      </View>

      {load === 'ready' && (
        <View style={styles.actions}>
          <RoundButton icon="arrow-undo" label={t('common.undo')} color={colors.gray[500]} size="sm"
            disabled={!deck.canUndo(state)} onPress={undo} />
          <RoundButton icon="close" label={t('feed.pass')} color={colors.danger} size="lg"
            disabled={!top} onPress={() => swipe('pass')} />
          {canLike && (
            <RoundButton icon="star" label={t('feed.superLike')} color="#2F6FD6"
              disabled={!top} onPress={() => swipe('super_like')} />
          )}
          {canLike && (
            <RoundButton icon="heart" label={t('feed.like')} color={colors.brand} size="lg"
              disabled={!top} onPress={() => swipe('like')} />
          )}
          <RoundButton icon="bookmark" label={t('feed.bookmark')} color="#B7791F" size="sm"
            disabled={!top} onPress={bookmark} />
        </View>
      )}

      <MatchModal
        name={newMatch?.name ?? null}
        onClose={() => setNewMatch(null)}
        onChat={() => {
          const id = newMatch?.id
          setNewMatch(null)
          router.navigate(id ? `/chat/${id}` : '/matches')
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: space.sm },
  brand: { fontSize: 24, color: colors.ink },
  count: { fontSize: 13, color: colors.muted },
  switcher: { marginTop: space.sm },
  deckArea: { flex: 1, marginHorizontal: space.lg, marginTop: space.md },
  center: { flex: 1, justifyContent: 'center', gap: space.lg, paddingHorizontal: space.lg },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingVertical: space.lg },
})
