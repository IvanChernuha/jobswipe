import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { sendFeedback } from '../lib/api'
import { Body, Button, ErrorBox, Field } from './ui'
import { colors, fonts, radius, space } from '../lib/theme'

/** Testers rate the app (1-5 stars) and say what they think; the team reads it on the admin page. */
export default function FeedbackCard({ token }: { token: string }) {
  const { t } = useTranslation()
  const [rating, setRating] = useState(0)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const f = fonts()

  async function send() {
    setSending(true)
    setError(null)
    try {
      await sendFeedback(token, {
        rating, message: message.trim(),
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        app_version: Constants.expoConfig?.version ?? '',
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mobile.loadFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={[styles.title, { fontFamily: f.semibold }]}>{t('mobile.feedbackTitle')}</Text>
      {sent ? (
        <Body>{t('mobile.feedbackThanks')}</Body>
      ) : (
        <>
          <Text style={[styles.hint, { fontFamily: f.regular }]}>{t('mobile.feedbackHint')}</Text>
          <View accessibilityRole="radiogroup" style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityLabel={t('mobile.stars', { count: n })}
                accessibilityState={{ checked: rating === n }}
                onPress={() => setRating(n)}
                hitSlop={4}
                style={styles.star}
              >
                <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={32} color={n <= rating ? '#E8A317' : colors.gray[400]} />
              </Pressable>
            ))}
          </View>
          <Field
            label={t('mobile.feedbackLabel')} placeholder={t('mobile.feedbackPlaceholder')} value={message}
            onChangeText={setMessage} multiline maxLength={5000} style={styles.message}
          />
          {error && <ErrorBox message={error} />}
          <Button title={t('mobile.sendFeedback')} onPress={send} busy={sending} disabled={rating === 0} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'left' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  star: { padding: 2 },
  message: { minHeight: 80, textAlignVertical: 'top', paddingTop: space.md },
})
