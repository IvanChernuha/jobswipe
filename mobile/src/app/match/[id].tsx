import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getJobPostings, getMatch, getMatchResume, moveMatch, type Match } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { matchToCard } from '../../lib/cards'
import { mediaUrl } from '../../lib/media'
import ProfileDetails, { BackHeader } from '../../components/ProfileDetails'
import ReportSheet from '../../components/ReportSheet'
import { Body, Button, ErrorBox, Screen } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'

// The other side of a match in full. Employers can open the candidate's CV
// here (only after a match, decision 2026-11-09) and move the match under
// another of their jobs (the candidate is notified).
export default function MatchProfile() {
  const { t } = useTranslation()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''
  const worker = role !== 'employer'

  const [match, setMatch] = useState<Match | null>(null)
  const [failed, setFailed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [cvError, setCvError] = useState(false)
  const [jobs, setJobs] = useState<{ id: string; title: string }[] | null>(null)
  const [moved, setMoved] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)

  useEffect(() => {
    if (!token || !id) return
    getMatch(token, id).then(setMatch).catch(() => setFailed(true))
  }, [token, id])

  async function openCv() {
    setOpening(true)
    setCvError(false)
    try {
      const url = mediaUrl(await getMatchResume(token, id))
      if (!url) throw new Error('no url')
      await Linking.openURL(url)
    } catch {
      setCvError(true)
    } finally {
      setOpening(false)
    }
  }

  async function showJobs() {
    setMoveError(null)
    try {
      setJobs((await getJobPostings(token)).map((j) => ({ id: j.id, title: j.title })))
    } catch {
      setMoveError(t('mobile.loadFailed'))
    }
  }

  async function moveTo(job: { id: string; title: string }) {
    if (!match || job.id === match.job_posting_id) return
    setMoveError(null)
    try {
      setMatch(await moveMatch(token, match.id, job.id))
      setMoved(job.title)
      setJobs(null)
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : t('jobs.couldNotUpdate'))
    }
  }

  const f = fonts()

  if (!match) {
    return (
      <Screen testID="screen-profile-details">
        <BackHeader title={t('nav.matches')} fallback="/matches" />
        <View style={styles.center}>
          {failed ? <ErrorBox message={t('mobile.loadFailed')} /> : <ActivityIndicator color={colors.brand} size="large" />}
        </View>
      </Screen>
    )
  }

  return (
    <ProfileDetails
      card={matchToCard(match, worker)}
      companyAbout={worker ? match.employer?.company_description : undefined}
      fallback="/matches"
    >
      {!worker && (match.worker?.has_resume
        ? <Button title={t('mobile.openCv')} onPress={openCv} busy={opening} />
        : <Body muted>{t('mobile.noCv')}</Body>)}
      {cvError && <ErrorBox message={t('mobile.cvFailed')} />}
      <Button title={t('matches.chat')} variant="secondary" onPress={() => router.push(`/chat/${match.id}`)} />
      {!worker && !jobs && <Button title={t('mobile.moveToJob')} variant="secondary" onPress={showJobs} />}
      {jobs && (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('mobile.moveToJob')} style={styles.jobs}>
          {jobs.map((job) => {
            const current = job.id === match.job_posting_id
            return (
              <Pressable
                key={job.id}
                accessibilityRole="radio"
                accessibilityLabel={job.title}
                accessibilityState={{ checked: current }}
                onPress={() => moveTo(job)}
                style={[styles.job, current && styles.jobOn]}
              >
                <Text style={[styles.jobText, { fontFamily: f.medium }]} numberOfLines={1}>{job.title}</Text>
                {current && <Text style={[styles.current, { fontFamily: f.regular }]}>{t('mobile.currentJob')}</Text>}
              </Pressable>
            )
          })}
        </View>
      )}
      {moved && <Body>{t('mobile.movedTo', { title: moved })}</Body>}
      {moveError && <ErrorBox message={moveError} />}
      <Button title={t('report.reportUser')} variant="secondary" onPress={() => setReporting(true)} />
      <ReportSheet
        visible={reporting}
        token={token}
        targetId={worker ? match.employer_id : match.worker_id}
        onClose={() => setReporting(false)}
        onBlocked={() => router.replace('/matches')}
      />
    </ProfileDetails>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  jobs: { gap: space.sm },
  job: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  jobOn: { borderColor: colors.brand, backgroundColor: colors.brandScale[50] },
  jobText: { flex: 1, fontSize: 15, color: colors.ink, textAlign: 'left' },
  current: { fontSize: 13, color: colors.brandDark },
})
