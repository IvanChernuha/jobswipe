import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { blockUser, submitReport, type ReportReason } from '../lib/api'
import { Body, Button, ErrorBox, Field } from './ui'
import { colors, fonts, radius, space, TOUCH } from '../lib/theme'

const REASONS: ReportReason[] = ['spam', 'inappropriate', 'fake', 'harassment', 'other']

/**
 * Report someone (the web ReportModal), and by default also block them, which
 * ends the match and hides you from each other. `onBlocked` runs when the
 * sheet closes after a block, so the screen can leave the dead match.
 */
export default function ReportSheet({
  visible, token, targetId, onClose, onBlocked,
}: { visible: boolean; token: string; targetId: string; onClose: () => void; onBlocked?: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const [block, setBlock] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'reported' | 'blocked' | null>(null)
  const f = fonts()

  async function submit() {
    setSending(true)
    setError(null)
    try {
      await submitReport(token, targetId, 'user', reason, details.trim())
      if (block) await blockUser(token, targetId)
      setDone(block ? 'blocked' : 'reported')
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('report.submitFailed'))
    } finally {
      setSending(false)
    }
  }

  function close() {
    const wasBlocked = done === 'blocked'
    setDone(null)
    setError(null)
    setDetails('')
    onClose()
    if (wasBlocked) onBlocked?.()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <KeyboardAvoidingView behavior="padding">
        <View style={styles.sheet} accessibilityViewIsModal>
          {done ? (
            <>
              <Ionicons name="shield-checkmark-outline" size={48} color={colors.brand} style={styles.center} />
              <Text style={[styles.title, styles.centerText, { fontFamily: f.semibold }]}>
                {done === 'blocked' ? t('report.reportedAndBlocked') : t('report.reportSubmitted')}
              </Text>
              <Body muted>{done === 'blocked' ? t('report.blockedThankYou') : t('report.submittedThankYou')}</Body>
              <Button title={t('common.done')} onPress={close} />
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Text style={[styles.title, { fontFamily: f.semibold }]}>{t('report.reportUser')}</Text>
              <Text style={[styles.label, { fontFamily: f.medium }]}>{t('report.reason')}</Text>
              <View accessibilityRole="radiogroup" style={styles.reasons}>
                {REASONS.map((r) => {
                  const on = r === reason
                  return (
                    <Pressable
                      key={r}
                      accessibilityRole="radio"
                      accessibilityLabel={t(`report.reasons.${r}`)}
                      accessibilityState={{ checked: on }}
                      onPress={() => setReason(r)}
                      style={[styles.reason, on && styles.reasonOn]}
                    >
                      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.brand : colors.gray[400]} />
                      <Text style={[styles.reasonText, { fontFamily: f.medium }]}>{t(`report.reasons.${r}`)}</Text>
                    </Pressable>
                  )
                })}
              </View>
              <Field
                label={t('report.detailsOptional')} placeholder={t('report.detailsPlaceholder')} value={details}
                onChangeText={setDetails} multiline maxLength={1000} style={styles.details}
              />
              <View style={styles.blockRow}>
                <View style={styles.flex}>
                  <Text style={[styles.reasonText, { fontFamily: f.medium }]}>{t('report.alsoBlock')}</Text>
                  <Text style={[styles.hint, { fontFamily: f.regular }]}>{t('report.blockHint')}</Text>
                </View>
                <Switch
                  accessibilityLabel={t('report.alsoBlock')}
                  value={block}
                  onValueChange={setBlock}
                  trackColor={{ true: colors.danger, false: colors.gray[300] }}
                  thumbColor="#fff"
                />
              </View>
              {error && <ErrorBox message={error} />}
              <Button title={block ? t('report.reportAndBlock') : t('report.submitReport')} onPress={submit} busy={sending} />
              <Button title={t('common.cancel')} variant="secondary" onPress={close} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '85%', gap: space.md, padding: space.lg, paddingBottom: space.xl,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
  },
  form: { gap: space.md },
  center: { alignSelf: 'center' },
  centerText: { textAlign: 'center' },
  title: { fontSize: 18, color: colors.ink, textAlign: 'left' },
  label: { fontSize: 14, color: colors.gray[700], textAlign: 'left' },
  reasons: { gap: space.xs },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH - 4, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  reasonOn: { borderColor: colors.brand, backgroundColor: colors.brandScale[50] },
  reasonText: { fontSize: 15, color: colors.ink, textAlign: 'left' },
  details: { minHeight: 80, textAlignVertical: 'top', paddingTop: space.md },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'left' },
})
