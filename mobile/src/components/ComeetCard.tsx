import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { connectComeet, disconnectComeet, getComeetStatus, syncComeet, type ComeetStatus } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { Button, ErrorBox, Field } from './ui'
import { colors, fonts, radius, space } from '../lib/theme'

const SETTINGS_URL = 'https://app.comeet.co/app/company/settings/careers'

/**
 * Jobs tab: import jobs from Comeet (OpenProject #3297), same as the web
 * ComeetCard. One paste of the UID + Token; the server imports every published
 * job in the background and keeps them in sync. Polls while an import runs.
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
  const [paste, setPaste] = useState('')
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

  const importing = status?.status === 'importing'
  usePolling(async () => {
    const next = await load()
    if (next && next.status !== 'importing') {
      setFound(null)
      changed.current()
    }
  }, 3000, importing)

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res = await connectComeet(token, paste)
      setFound({ company: res.company_name, count: res.found })
      setOpen(false)
      setPaste('')
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
    return (
      <View style={styles.card}>
        <Text style={[styles.title, { fontFamily: f.semibold }]}>{t('comeet.title')}</Text>
        <Text style={[styles.text, { fontFamily: f.regular }]}>{t('comeet.pitch')}</Text>
        {!open ? (
          <Button title={t('comeet.start')} onPress={() => setOpen(true)} />
        ) : (
          <>
            {[t('comeet.step1'), t('comeet.step2'), t('comeet.step3')].map((step, i) => (
              <Text key={i} style={[styles.text, { fontFamily: f.regular }]}>{`${i + 1}. ${step}`}</Text>
            ))}
            <Pressable accessibilityRole="button" onPress={() => Linking.openURL(SETTINGS_URL)} hitSlop={8}>
              <Text style={[styles.link, { fontFamily: f.medium }]}>{t('comeet.openSettings')}</Text>
            </Pressable>
            <Field
              label={t('comeet.pasteLabel')} placeholder={t('comeet.pastePlaceholder')} value={paste}
              onChangeText={setPaste} multiline autoCapitalize="none" autoCorrect={false} style={styles.paste}
            />
            {error && <ErrorBox message={error} />}
            <Button title={t('comeet.connect')} onPress={connect} busy={busy} disabled={!paste.trim()} />
            <Button title={t('comeet.cancel')} variant="secondary" onPress={() => { setOpen(false); setError(null) }} />
          </>
        )}
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
  paste: { minHeight: 72, textAlignVertical: 'top', paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
})
