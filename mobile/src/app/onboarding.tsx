import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { Body, Button, Screen, Title } from '../components/ui'
import { space } from '../lib/theme'

// Placeholder until Mobile P3 (onboarding: profile, photo, skills).
export default function Onboarding() {
  const { t } = useTranslation()
  const router = useRouter()
  const { finishOnboarding } = useAuth()
  return (
    <Screen testID="screen-onboarding">
      <View style={styles.content}>
        <Title>{t('mobile.onboardingTitle')}</Title>
        <Body muted>{t('mobile.onboardingBody')}</Body>
        <Button
          title={t('mobile.continue')}
          onPress={() => {
            finishOnboarding()
            router.replace('/feed')
          }}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg },
})
