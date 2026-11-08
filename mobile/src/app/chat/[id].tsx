import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, FlatList, I18nManager, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { getMatch, getMessages, sendMessage, type Match, type Message } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { otherSide } from '../../lib/matches'
import { usePolling } from '../../lib/usePolling'
import Avatar from '../../components/Avatar'
import { Body, Screen } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'
import i18n from '../../lib/i18n'

/** New messages are fetched this often while the chat is open (same as web). */
const POLL_MS = 3000

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return i18n.t('chat.today')
  if (d.toDateString() === yesterday.toDateString()) return i18n.t('chat.yesterday')
  return d.toLocaleDateString(i18n.resolvedLanguage ?? 'en', { weekday: 'short', month: 'short', day: 'numeric' })
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.resolvedLanguage ?? 'en', { hour: '2-digit', minute: '2-digit' })
}

// Same as the web Chat.tsx: the conversation, polling for new messages, and
// a refused message (content filter, blocked) keeps the draft and says why.
export default function Chat() {
  const { t } = useTranslation()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''

  const [match, setMatch] = useState<Match | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [m, msgs] = await Promise.all([getMatch(token, id), getMessages(token, id)])
      setMatch(m)
      setMessages(msgs)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => {
    if (token && id) load()
  }, [token, id, load])

  usePolling(() => {
    getMessages(token, id).then(setMessages).catch(() => {})
  }, POLL_MS, !!token && !!id)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/matches'))

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      const msg = await sendMessage(token, id, body)
      setMessages((prev) => [...prev, msg])
      setDraft('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t('chat.messageNotSent'))
    } finally {
      setSending(false)
    }
  }

  const f = fonts()
  const other = match
    ? otherSide(match, role !== 'employer', t)
    : { name: role === 'employer' ? t('chat.worker') : t('chat.employer'), avatar: null }
  const canSend = !!draft.trim() && !sending

  return (
    <Screen testID="screen-chat">
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={back} style={styles.iconButton}>
            <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.ink} />
          </Pressable>
          <Avatar name={other.name} url={other.avatar} size={38} />
          <View style={styles.flex}>
            <Text style={[styles.name, { fontFamily: f.semibold }]} numberOfLines={1}>{other.name}</Text>
            {match && (
              <Text style={[styles.sub, { fontFamily: f.regular }]} numberOfLines={1}>
                {role === 'employer'
                  ? match.worker?.experience_years != null ? t('matches.yrsExp', { count: match.worker.experience_years }) : ''
                  : match.employer?.job_title ?? ''}
              </Text>
            )}
          </View>
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        )}
        {!loading && error && (
          <View style={styles.center}>
            <Body>{t('chat.failedToLoad')}</Body>
            <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
              <Text style={[styles.retryText, { fontFamily: f.semibold }]}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}
        {!loading && !error && (
          <FlatList
            style={styles.flex}
            // Inverted: newest at the bottom, and the list starts scrolled there.
            inverted={messages.length > 0}
            data={[...messages].reverse()}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.hello}>
                <Ionicons name="happy-outline" size={48} color={colors.brandScale[400]} style={styles.helloIcon} />
                <Body muted>{t('chat.sayHello', { name: other.name })}</Body>
              </View>
            }
            renderItem={({ item: m, index }) => {
              // The list is reversed: the message shown above this one is index + 1.
              const above = messages[messages.length - 2 - index]
              const newDay = !above || !sameDay(above.created_at, m.created_at)
              return (
                <View>
                  {newDay && <Text style={[styles.day, { fontFamily: f.semibold }]}>{dayLabel(m.created_at)}</Text>}
                  <View style={[styles.bubble, m.is_mine ? styles.mine : styles.theirs]}>
                    <Text style={[styles.body, { fontFamily: f.regular }, m.is_mine && styles.mineText]}>{m.body}</Text>
                    <Text style={[styles.time, { fontFamily: f.regular }, m.is_mine && styles.mineTime]}>{time(m.created_at)}</Text>
                  </View>
                </View>
              )
            }}
          />
        )}

        {sendError && (
          <View accessibilityRole="alert" style={styles.sendError}>
            <Text style={[styles.sendErrorText, { fontFamily: f.regular }]}>{t('chat.notSent', { error: sendError })}</Text>
          </View>
        )}

        <View style={styles.composer}>
          <TextInput
            accessibilityLabel={t('chat.typeMessage')}
            placeholder={t('chat.typeMessage')}
            placeholderTextColor={colors.gray[400]}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={5000}
            style={[styles.input, { fontFamily: f.regular }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.send')}
            accessibilityState={{ disabled: !canSend, busy: sending }}
            disabled={!canSend}
            onPress={send}
            style={[styles.send, !canSend && styles.sendOff]}
          >
            <Ionicons name="send" size={20} color="#fff" style={I18nManager.isRTL && styles.flip} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  sub: { fontSize: 13, color: colors.muted, textAlign: 'left' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  retry: { minHeight: TOUCH, paddingHorizontal: space.xl, justifyContent: 'center' },
  retryText: { color: colors.brand, fontSize: 16 },
  messages: { padding: space.lg, gap: space.xs, flexGrow: 1 },
  hello: { flex: 1, justifyContent: 'center', paddingVertical: space.xxl, gap: space.md },
  helloIcon: { alignSelf: 'center' },
  day: { alignSelf: 'center', fontSize: 11, color: colors.gray[400], marginVertical: space.md, textTransform: 'uppercase' },
  bubble: { maxWidth: '80%', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, marginVertical: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomEndRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomStartRadius: 4, borderWidth: 1, borderColor: colors.border },
  body: { fontSize: 15, lineHeight: 21, color: colors.ink, textAlign: 'left' },
  mineText: { color: '#fff' },
  time: { fontSize: 10, color: colors.gray[400], alignSelf: 'flex-end', marginTop: 2 },
  mineTime: { color: 'rgba(255,255,255,0.75)' },
  sendError: { backgroundColor: colors.dangerBg, paddingHorizontal: space.lg, paddingVertical: space.sm },
  sendErrorText: { color: colors.danger, fontSize: 13 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.sm,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, minHeight: TOUCH, maxHeight: 140, borderRadius: radius.xl, paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: colors.ground, fontSize: 16, color: colors.ink, textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  send: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.35 },
  flip: { transform: [{ scaleX: -1 }] },
})
