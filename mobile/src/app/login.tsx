import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { Body, Button, ErrorBox, Field, LinkText, Screen, Title } from '../components/ui'
import LanguageSwitch from '../components/LanguageSwitch'
import { space } from '../lib/theme'

export default function Login() {
  const { t } = useTranslation()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!email.trim() || !password) return
    setError(null)
    setBusy(true)
    try {
      // Same Supabase accounts as the web; the session change routes to the app.
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) setError(authError.message || t('login.failed'))
    } catch {
      setError(t('login.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            <LanguageSwitch />
          </View>
          <Title>{t('login.welcomeBack')}</Title>
          <Body muted>{t('login.subtitle')}</Body>
          <View style={styles.form}>
            {error && <ErrorBox message={error} />}
            <Field
              label={t('common.emailAddress')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Field
              label={t('common.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={submit}
            />
            <Button title={busy ? t('login.signingIn') : t('common.signIn')} onPress={submit} busy={busy} />
          </View>
          <Body muted>
            {t('login.noAccount')}{' '}
            <LinkText onPress={() => router.push('/register')}>{t('login.createOneFree')}</LinkText>
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
  top: { position: 'absolute', top: space.lg, end: space.lg },
  form: { gap: space.lg, marginVertical: space.xl },
})
