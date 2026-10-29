import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import LanguageSwitch from '../../components/LanguageSwitch'
import { Body, Button, Screen, Title } from '../../components/ui'
import { space } from '../../lib/theme'

// Account basics for now; the full profile (CV, prefs, export, delete) is Mobile P6.
export default function Profile() {
  const { t } = useTranslation()
  const { session, role, signOut } = useAuth()
  return (
    <Screen testID="screen-profile">
      <View style={styles.content}>
        <Title>{t('nav.profile')}</Title>
        <View style={styles.block}>
          <Body muted>{t('mobile.signedInAs')}</Body>
          <Body>{session?.user.email ?? ''}</Body>
          {role && <Body muted>{t(role === 'employer' ? 'register.employer' : 'register.worker')}</Body>}
        </View>
        <View style={styles.block}>
          <Body muted>{t('common.language')}</Body>
          <View style={styles.center}>
            <LanguageSwitch />
          </View>
        </View>
        <Button title={t('nav.signOut')} variant="secondary" onPress={signOut} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  block: { gap: space.xs },
  center: { alignItems: 'center' },
})
