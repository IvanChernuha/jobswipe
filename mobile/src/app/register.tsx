import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Role } from '@jobswipe/shared/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Body, Button, Choice, ErrorBox, Field, LinkText, Screen, Title } from '../components/ui'
import LanguageSwitch from '../components/LanguageSwitch'
import { space } from '../lib/theme'

const MIN_PASSWORD = 8 // same as the web

export default function Register() {
  const { t } = useTranslation()
  const router = useRouter()
  const { markNewAccount, finishOnboarding } = useAuth()
  const [role, setRole] = useState<Role>('worker')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!email.trim() || password.length < MIN_PASSWORD) {
      setError(t('register.minChars', { count: MIN_PASSWORD }))
      return
    }
    setError(null)
    setBusy(true)
    try {
      // The role goes into user_metadata, exactly like the web sign-up.
      markNewAccount()
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { role } },
      })
      if (signUpError) {
        finishOnboarding()
        setError(signUpError.message || t('register.failed'))
      }
    } catch {
      finishOnboarding()
      setError(t('register.failed'))
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
          <Title>{t('register.title')}</Title>
          <Body muted>{t('register.subtitle')}</Body>
          <View style={styles.form}>
            {error && <ErrorBox message={error} />}
            <Body>{t('register.iAmA')}</Body>
            <Choice<Role>
              value={role}
              onChange={setRole}
              options={[
                { value: 'worker', label: t('register.worker') },
                { value: 'employer', label: t('register.employer') },
              ]}
            />
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
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder={t('register.minChars', { count: MIN_PASSWORD })}
            />
            <Button title={busy ? t('register.creatingAccount') : t('register.createAccount')} onPress={submit} busy={busy} />
          </View>
          <Body muted>
            <LinkText onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}>
              {t('register.signInInstead')}
            </LinkText>
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
