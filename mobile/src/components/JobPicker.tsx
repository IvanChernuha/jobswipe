import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'
import { colors, fonts, radius, space, TOUCH } from '../lib/theme'

export interface PickJob {
  /** null = "Unsorted" (saved candidates only). */
  id: string | null
  title: string
}

/**
 * Bottom sheet: pick the job to move a match or saved candidate to. The job
 * it is under now is marked; picking it again just closes the sheet.
 */
export default function JobPicker({
  title, jobs, current, onPick, onClose,
}: {
  title: string | null
  jobs: PickJob[]
  current: string | null
  onPick: (job: PickJob) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const f = fonts()
  return (
    <Modal visible={!!title} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <Text style={[styles.title, { fontFamily: f.semibold }]} numberOfLines={2}>{title}</Text>
        <ScrollView accessibilityRole="radiogroup" contentContainerStyle={styles.list}>
          {jobs.map((job) => {
            const on = job.id === current
            return (
              <Pressable
                key={job.id ?? 'none'}
                accessibilityRole="radio"
                accessibilityLabel={job.title}
                accessibilityState={{ checked: on }}
                onPress={() => (on ? onClose() : onPick(job))}
                style={({ pressed }) => [styles.job, on && styles.jobOn, pressed && styles.pressed]}
              >
                <Ionicons name={job.id ? 'briefcase-outline' : 'file-tray-outline'} size={18} color={on ? colors.brandDark : colors.gray[500]} />
                <Text style={[styles.jobText, { fontFamily: f.medium }]} numberOfLines={1}>{job.title}</Text>
                {on && <Text style={[styles.current, { fontFamily: f.regular }]}>{t('mobile.currentJob')}</Text>}
              </Pressable>
            )
          })}
        </ScrollView>
        <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '70%', gap: space.md, padding: space.lg, paddingBottom: space.xl,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
  },
  title: { fontSize: 17, color: colors.ink, textAlign: 'left' },
  list: { gap: space.sm },
  job: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  jobOn: { borderColor: colors.brand, backgroundColor: colors.brandScale[50] },
  pressed: { opacity: 0.7 },
  jobText: { flex: 1, fontSize: 15, color: colors.ink, textAlign: 'left' },
  current: { fontSize: 13, color: colors.brandDark },
})
