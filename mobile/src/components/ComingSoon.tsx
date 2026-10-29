import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Body, Screen, Title } from './ui'
import { space } from '../lib/theme'

/** Placeholder for tabs built in later phases (feed P4, matches P5, …). */
export default function ComingSoon({ testID, title }: { testID: string; title: string }) {
  const { t } = useTranslation()
  return (
    <Screen testID={testID}>
      <View style={styles.content}>
        <Title>{title}</Title>
        <Body muted>{t('mobile.comingSoon')}</Body>
        <Body muted>{t('mobile.comingSoonBody')}</Body>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
})
