import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { readComeetPaste } from '@jobswipe/shared/comeet'
import { connectComeet, disconnectComeet, getComeetStatus, syncComeet, type ComeetStatus } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { secureSessionStorage } from '../lib/secureStorage'
import { Button, ErrorBox, Field } from './ui'
import { colors, fonts, radius, space } from '../lib/theme'

const SETTINGS_URL = 'https://app.comeet.co/app/company/settings/careers'
/** The open popup and what was typed, so it survives the trip to Comeet (encrypted, like the login). */
const DRAFT = 'comeet-draft'

/**
 * Jobs tab: import jobs from Comeet (OpenProject #3297), same as the web
 * ComeetCard. A popup with a UID box and a Token box, each with a Paste button
 * (user 2026-11-27); the server imports every published job in the background
 * and keeps them in sync. Polls while an import runs.
 */
export default function ComeetCard({ token, onJobsChanged, needCheck = 0 }: {
  token: string
  onJobsChanged: () => void
  /** Imported jobs held off by the job check (missing something). */
  needCheck?: number
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ComeetStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [uid, setUid] = useState('')
  const [secret, setSecret] = useState('')
  const [pasteBlocked, setPasteBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ company: string; count: number } | null>(null)
  const changed = useRef(onJobsChanged)
  changed.current = onJobsChanged
  const f = fonts()

  const load = useCallback(async () => {
    try {
      const next = await getComeetStatus(token)
      setStatus(next)
      return next
    } catch {
      return null
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // Opening Comeet sends the app to the background, where the phone may close
  // it: bring the popup back as it was (user 2026-11-27).
  const restored = useRef(false)
  useEffect(() => {
    secureSessionStorage.getItem(DRAFT)
      .then((raw) => {
        if (!raw) return
        const draft = JSON.parse(raw) as { uid?: string; token?: string }
        setUid(draft.uid ?? '')
        setSecret(draft.token ?? '')
        setOpen(true)
      })
      .catch(() => {})
      .finally(() => { restored.current = true })
  }, [])
  // One write at a time, so a slow save can't bring the draft back after Cancel.
  const saving = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!restored.current) return
    const write = open
      ? () => secureSessionStorage.setItem(DRAFT, JSON.stringify({ uid, token: secret }))
      : () => secureSessionStorage.removeItem(DRAFT)
    saving.current = saving.current.then(write).catch(() => {})
  }, [open, uid, secret])

  /** Comeet opens on top of the app (✕ comes back to the popup); the phone browser if that fails. */
  async function openSettings() {
    try {
      await WebBrowser.openBrowserAsync(SETTINGS_URL)
    } catch {
      Linking.openURL(SETTINGS_URL)
    }
  }

  const importing = status?.status === 'importing'
  usePolling(async () => {
    const next = await load()
    if (next && next.status !== 'importing') {
      setFound(null)
      changed.current()
    }
  }, 3000, importing)

  /** Sort a paste into the right box(es); unrecognised text goes where it was pasted. */
  function fill(text: string, into: 'uid' | 'token') {
    const found = readComeetPaste(text)
    if (found.uid) setUid(found.uid)
    if (found.token) setSecret(found.token)
    if (!found.uid && !found.token) (into === 'uid' ? setUid : setSecret)(text.trim())
  }

  async function pasteInto(into: 'uid' | 'token') {
    setPasteBlocked(false)
    try {
      const text = await Clipboard.getStringAsync()
      if (!text.trim()) setPasteBlocked(true)
      else fill(text, into)
    } catch {
      setPasteBlocked(true)
    }
  }

  /** Typing goes in as typed; a paste of both values (only a paste can hold both) is split. */
  function onChange(text: string, into: 'uid' | 'token') {
    const found = readComeetPaste(text)
    if (found.uid && found.token) fill(text, into)
    else (into === 'uid' ? setUid : setSecret)(text)
  }

  function closeDialog() {
    setOpen(false)
    setUid('')
    setSecret('')
    setError(null)
    setPasteBlocked(false)
  }

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res = await connectComeet(token, `${uid.trim()} ${secret.trim()}`)
      setFound({ company: res.company_name, count: res.found })
      closeDialog()
      setStatus((s) => ({ ...(s ?? {}), connected: true, company_name: res.company_name, status: 'importing' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setError(null)
    try {
      await syncComeet(token)
      setStatus((s) => ({ ...(s ?? { connected: true }), status: 'importing' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function confirmDisconnect() {
    Alert.alert(t('comeet.disconnect'), t('comeet.disconnectConfirm'), [
      { text: t('comeet.cancel'), style: 'cancel' },
      {
        text: t('comeet.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectComeet(token)
            setStatus({ connected: false })
            changed.current()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        },
      },
    ])
  }

  if (!status) return null

  if (!status.connected) {
    const ready = uid.trim() !== '' && secret.trim() !== ''
    const field = (id: 'uid' | 'token', value: string) => (
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field
            label={t(id === 'uid' ? 'comeet.uidLabel' : 'comeet.tokenLabel')}
            placeholder={t(id === 'uid' ? 'comeet.uidPlaceholder' : 'comeet.tokenPlaceholder')}
            value={value} onChangeText={(text) => onChange(text, id)}
            autoCapitalize="none" autoCorrect={false} style={styles.mono}
          />
        </View>
        <Pressable
          accessibilityRole="button" accessibilityLabel={t(id === 'uid' ? 'comeet.pasteUid' : 'comeet.pasteToken')}
          onPress={() => pasteInto(id)} hitSlop={6} style={({ pressed }) => [styles.paste, pressed && styles.pressed]}
        >
          <Text style={[styles.pasteText, { fontFamily: f.semibold }]}>{t('comeet.paste')}</Text>
        </Pressable>
      </View>
    )
    return (
      <View style={styles.card}>
        <Text style={[styles.title, { fontFamily: f.semibold }]}>{t('comeet.title')}</Text>
        <Text style={[styles.text, { fontFamily: f.regular }]}>{t('comeet.pitch')}</Text>
        <Button title={t('comeet.start')} onPress={() => setOpen(true)} />
        <Modal visible={open} transparent animationType="slide" onRequestClose={closeDialog}>
          <Pressable style={styles.backdrop} onPress={closeDialog} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
            <View style={styles.sheet} accessibilityViewIsModal>
              <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
                <Text style={[styles.sheetTitle, { fontFamily: f.semibold }]}>{t('comeet.dialogTitle')}</Text>
                <Text style={[styles.text, { fontFamily: f.regular }]}>{t('comeet.where')}</Text>
                <Pressable accessibilityRole="button" onPress={openSettings} hitSlop={8}>
                  <Text style={[styles.link, { fontFamily: f.medium }]}>{t('comeet.openSettings')}</Text>
                </Pressable>
                {field('uid', uid)}
                {field('token', secret)}
                {pasteBlocked && <Text style={[styles.hint, { fontFamily: f.regular }]}>{t('comeet.pasteBlocked')}</Text>}
                <Text style={[styles.small, { fontFamily: f.regular }]}>{t('comeet.safe')}</Text>
                {error && <ErrorBox message={error} />}
                <Button title={t('comeet.connect')} onPress={connect} busy={busy} disabled={!ready} />
                <Button title={t('comeet.cancel')} variant="secondary" onPress={closeDialog} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    )
  }

  return (
    <View style={styles.card} accessibilityState={{ busy: importing }}>
      {importing ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.brand} />
          <Text style={[styles.text, styles.flex, { fontFamily: f.regular }]}>
            {found ? t('comeet.found', { count: found.count, company: found.company }) : t('comeet.importing')}
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.title, { fontFamily: f.semibold }]}>
            {t('comeet.connected', { count: status.live_count ?? 0, company: status.company_name })}
          </Text>
          {status.last_synced_at && (
            <Text style={[styles.text, { fontFamily: f.regular }]}>
              {t('comeet.lastSynced', { time: new Date(status.last_synced_at).toLocaleString() })}
            </Text>
          )}
          {status.status === 'error' && status.last_error && (
            <ErrorBox message={t('comeet.error', { error: status.last_error })} />
          )}
          {needCheck > 0 && (
            <Text style={[styles.warn, { fontFamily: f.medium }]}>{t('jobCheck.comeetNeedCheck', { count: needCheck })}</Text>
          )}
          {error && <ErrorBox message={error} />}
          <View style={styles.row}>
            <View style={styles.flex}><Button title={t('comeet.syncNow')} variant="secondary" onPress={syncNow} /></View>
            <View style={styles.flex}><Button title={t('comeet.disconnect')} variant="secondary" onPress={confirmDisconnect} /></View>
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignSelf: 'stretch' },
  title: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  text: { fontSize: 14, color: colors.muted, textAlign: 'left' },
  link: { fontSize: 14, color: colors.brand, textDecorationLine: 'underline', textAlign: 'left' },
  warn: { fontSize: 14, color: '#B91C1C', textAlign: 'left' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  paste: { marginTop: 22, minHeight: 44, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand },
  pasteText: { fontSize: 14, color: colors.brand },
  pressed: { opacity: 0.6 },
  hint: { fontSize: 14, color: '#B45309', textAlign: 'left' },
  small: { fontSize: 12, color: colors.muted, textAlign: 'left' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%' },
  form: { padding: space.lg, gap: space.md },
  sheetTitle: { fontSize: 18, color: colors.ink, textAlign: 'left' },
  flex: { flex: 1 },
})
