import { Modal, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'
import { colors, fonts, radius, space } from '../lib/theme'

export default function MatchModal({
  name, onChat, onClose,
}: { name: string | null; onChat: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const f = fonts()
  return (
    <Modal visible={!!name} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Ionicons name="heart" size={56} color={colors.brand} />
          <Text style={[styles.title, { fontFamily: f.display }]}>{t('match.itsAMatch')}</Text>
          <Text style={[styles.body, { fontFamily: f.regular }]}>{t('match.bothSwipedRight', { name })}</Text>
          <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('match.startConversation')}</Text>
          <View style={styles.actions}>
            <Button title={t('match.startChat')} onPress={onChat} />
            <Button title={t('match.keepSwiping')} variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,33,61,0.55)', justifyContent: 'center', padding: space.xl },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl, alignItems: 'center', gap: space.md },
  title: { fontSize: 32, color: colors.ink },
  body: { fontSize: 17, color: colors.ink, textAlign: 'center' },
  muted: { fontSize: 15, color: colors.muted, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.md, marginTop: space.md },
})
