import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors, fonts, radius, space } from '../lib/theme'

/** Employer feed: look at candidates for all live jobs, or for one of them. */
export default function JobSwitcher({
  jobs, selected, onSelect,
}: { jobs: { id: string; title: string }[]; selected: string | null; onSelect: (jobId: string | null) => void }) {
  const { t } = useTranslation()
  const f = fonts()
  const options = [{ id: null, title: t('mobile.allJobs') }, ...jobs]
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('mobile.candidatesFor')}
      contentContainerStyle={styles.row}
    >
      {options.map((job) => {
        const on = job.id === selected
        return (
          <Pressable
            key={job.id ?? 'all'}
            accessibilityRole="radio"
            accessibilityLabel={job.title}
            accessibilityState={{ checked: on }}
            onPress={() => onSelect(job.id)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text numberOfLines={1} style={[styles.text, { fontFamily: f.semibold }, on && styles.textOn]}>{job.title}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
  chip: {
    minHeight: 40, maxWidth: 220, justifyContent: 'center', paddingHorizontal: space.lg,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  text: { fontSize: 14, color: colors.gray[700] },
  textOn: { color: '#fff' },
})
