import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { colors, fonts, radius, space } from '../lib/theme'

type Issue = { code: string; level: string }

/**
 * The job check (user 2026-11-26), same as the web JobChecklist: what a job
 * still needs before it can go live (red) and tips (amber), or "Ready to go
 * live". `compact` shows only what's missing, for the job list.
 */
export default function JobChecklist({ issues, compact = false }: { issues: Issue[]; compact?: boolean }) {
  const { t } = useTranslation()
  const f = fonts()
  const must = issues.filter((i) => i.level === 'must')
  const should = compact ? [] : issues.filter((i) => i.level === 'should')
  if (compact && must.length === 0) return null

  return (
    <View style={[styles.box, must.length ? styles.missing : styles.ready]}>
      {must.length > 0 ? (
        <>
          <Text style={[styles.heading, styles.red, { fontFamily: f.semibold }]}>{t('jobCheck.stillNeeded')}</Text>
          {must.map((i) => (
            <Text key={i.code} style={[styles.line, styles.red, { fontFamily: f.regular }]}>{`• ${t(`jobCheck.${i.code}`)}`}</Text>
          ))}
        </>
      ) : (
        <Text style={[styles.heading, styles.green, { fontFamily: f.semibold }]}>{`✓ ${t('jobCheck.ready')}`}</Text>
      )}
      {should.length > 0 && (
        <>
          <Text style={[styles.heading, styles.amber, { fontFamily: f.semibold }]}>{t('jobCheck.tips')}</Text>
          {should.map((i) => (
            <Text key={i.code} style={[styles.line, styles.amber, { fontFamily: f.regular }]}>{`• ${t(`jobCheck.${i.code}`)}`}</Text>
          ))}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, gap: 2, alignSelf: 'stretch' },
  missing: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  ready: { backgroundColor: colors.brandScale[50], borderColor: colors.brandScale[100] },
  heading: { fontSize: 14, textAlign: 'left' },
  line: { fontSize: 14, textAlign: 'left' },
  red: { color: '#B91C1C' },
  green: { color: colors.brandScale[700] },
  amber: { color: '#B45309' },
})
