import { useEffect, useState } from 'react'
import {
  ActivityIndicator, I18nManager, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import * as DocumentPicker from 'expo-document-picker'
import {
  createJobPosting, getJobPostings, parseJobFiles, parseJobText, updateJobPosting, type JobInput, type ParsedJob, type Tag,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import SkillPicker from './SkillPicker'
import { Body, Button, ErrorBox, Field, Screen } from './ui'
import { colors, fonts, space, TOUCH } from '../lib/theme'

const DEFAULT_DAYS = 30
/** The AI needs a few words about the job (the server asks for 20+ characters). */
const MIN_AI_TEXT = 20
const JOB_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]

const daysLeft = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
const num = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0

/** Create a job (no jobId) or edit one; same fields as the web JobFormModal. */
export default function JobForm({ jobId }: { jobId?: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const { session } = useAuth()
  const token = session?.access_token ?? ''

  const [loading, setLoading] = useState(!!jobId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [minExperience, setMinExperience] = useState('')
  const [remote, setRemote] = useState(false)
  const [days, setDays] = useState(String(DEFAULT_DAYS))
  const [skills, setSkills] = useState<Tag[]>([])
  const [required, setRequired] = useState<Set<string>>(new Set())
  // "At least one of" skills have no phone editor yet; editing keeps them as they are.
  const [preferred, setPreferred] = useState<Tag[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState<'text' | 'file' | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId || !token) return
    getJobPostings(token)
      .then((jobs) => {
        const job = jobs.find((j) => j.id === jobId)
        if (!job) throw new Error(t('jobs.failedToLoad'))
        setTitle(job.title)
        setDescription(job.description ?? '')
        setLocation(job.location ?? '')
        setSalaryMin(job.salary_min ? String(job.salary_min) : '')
        setSalaryMax(job.salary_max ? String(job.salary_max) : '')
        setMinExperience(job.min_experience_years ? String(job.min_experience_years) : '')
        setRemote(job.remote)
        setDays(String(daysLeft(job.expires_at)))
        const tags = job.tags ?? []
        setSkills(tags.filter((s) => s.requirement !== 'preferred'))
        setRequired(new Set(tags.filter((s) => s.requirement === 'required').map((s) => s.id)))
        setPreferred(tags.filter((s) => s.requirement === 'preferred'))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('jobs.failedToLoad')))
      .finally(() => setLoading(false))
  }, [jobId, token, t])

  /** Fill what the AI found into the form: empty fields only, and skills not
   *  chosen yet. Must-have stays must-have; "at least one of" has no phone
   *  editor, so those become normal skills (they only raise the score). */
  function applyAi(job: ParsedJob) {
    if (!title.trim() && job.title) setTitle(job.title)
    if (!description.trim() && job.description) setDescription(job.description)
    if (!location.trim() && job.location) setLocation(job.location)
    if (!salaryMin && job.salary_min) setSalaryMin(String(job.salary_min))
    if (!salaryMax && job.salary_max) setSalaryMax(String(job.salary_max))
    if (!minExperience && job.min_experience_years) setMinExperience(String(job.min_experience_years))
    if (job.remote) setRemote(true)

    const have = new Set(skills.map((s) => s.id))
    const found = (ids: string[], names: string[], must: boolean) =>
      ids.map((id, i) => ({ tag: { id, name: names[i] ?? id, category: '' }, must }))
    const added: { tag: Tag; must: boolean }[] = []
    for (const a of [
      ...found(job.required_tag_ids, job.required_tags, true),
      ...found(job.preferred_tag_ids, job.preferred_tags, false),
      ...found(job.tag_ids, job.nice_tags, false),
    ]) {
      if (have.has(a.tag.id)) continue
      have.add(a.tag.id)
      added.push(a)
    }
    setSkills((prev) => [...prev, ...added.map((a) => a.tag)])
    setRequired((prev) => new Set([...prev, ...added.filter((a) => a.must).map((a) => a.tag.id)]))
    setAiNote(added.length ? t('mobile.aiAdded', { count: added.length }) : t('mobile.aiNothing'))
  }

  async function fillWithAi() {
    if (aiBusy) return
    setAiBusy('text')
    setError(null)
    setAiNote(null)
    try {
      applyAi(await parseJobText(token, [title.trim(), description.trim()].filter(Boolean).join('\n\n')))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('jobs.couldNotParse'))
    } finally {
      setAiBusy(null)
    }
  }

  async function fromFile() {
    if (aiBusy) return
    const pick = await DocumentPicker.getDocumentAsync({ type: JOB_FILE_TYPES, copyToCacheDirectory: true })
    if (pick.canceled || !pick.assets?.length) return
    const file = pick.assets[0]
    setAiBusy('file')
    setError(null)
    setAiNote(null)
    try {
      const [job] = await parseJobFiles(token, [
        { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' },
      ])
      if (!job || job.error) throw new Error(job?.error ?? t('jobs.couldNotParse'))
      applyAi(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('jobs.couldNotParse'))
    } finally {
      setAiBusy(null)
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/jobs'))

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    const data: JobInput = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      salary_min: num(salaryMin),
      salary_max: num(salaryMax),
      remote,
      min_experience_years: num(minExperience) || null,
      expires_in_days: num(days) || DEFAULT_DAYS,
      required_tag_ids: skills.filter((s) => required.has(s.id)).map((s) => s.id),
      tag_ids: skills.filter((s) => !required.has(s.id)).map((s) => s.id),
      preferred_tag_ids: preferred.map((s) => s.id),
    }
    try {
      if (jobId) await updateJobPosting(token, jobId, data)
      else await createJobPosting(token, data)
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('jobs.couldNotSave'))
    } finally {
      setSaving(false)
    }
  }

  const f = fonts()
  const setRequiredFor = (id: string, on: boolean) =>
    setRequired((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <Screen testID="screen-job-form">
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={back} style={styles.iconButton}>
            <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.ink} />
          </Pressable>
          <Text style={[styles.headerTitle, { fontFamily: f.semibold }]} numberOfLines={1}>
            {jobId ? t('jobs.editJobPosting') : t('jobs.createJobPosting')}
          </Text>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Field label={t('jobs.form.jobTitle')} placeholder={t('jobs.form.jobTitlePlaceholder')} value={title} onChangeText={setTitle} maxLength={200} />
            <Field
              label={t('common.description')} placeholder={t('jobs.form.descriptionPlaceholder')}
              value={description} onChangeText={setDescription} multiline style={styles.multiline}
            />
            <View style={styles.aiBox}>
              <Text style={[styles.aiHint, { fontFamily: f.regular }]}>{t('mobile.aiHint')}</Text>
              <View style={styles.pair}>
                <View style={styles.flex}>
                  <Button
                    title={t('mobile.fillWithAi')}
                    onPress={fillWithAi}
                    busy={aiBusy === 'text'}
                    disabled={!!aiBusy || description.trim().length < MIN_AI_TEXT}
                  />
                </View>
                <View style={styles.flex}>
                  <Button title={t('mobile.fromFile')} variant="secondary" onPress={fromFile} busy={aiBusy === 'file'} disabled={!!aiBusy} />
                </View>
              </View>
              {aiNote && <Text style={[styles.aiNote, { fontFamily: f.medium }]}>{aiNote}</Text>}
            </View>
            <Field label={t('common.location')} value={location} onChangeText={setLocation} />
            <View style={styles.switchRow}>
              <Text style={[styles.label, { fontFamily: f.medium }]}>{t('mobile.remoteJob')}</Text>
              <Switch
                accessibilityLabel={t('mobile.remoteJob')}
                value={remote}
                onValueChange={setRemote}
                trackColor={{ true: colors.brand, false: colors.gray[300] }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.pair}>
              <View style={styles.flex}>
                <Field label={t('mobile.minSalaryMonthly')} value={salaryMin} onChangeText={setSalaryMin} keyboardType="number-pad" />
              </View>
              <View style={styles.flex}>
                <Field label={t('mobile.maxSalaryMonthly')} value={salaryMax} onChangeText={setSalaryMax} keyboardType="number-pad" />
              </View>
            </View>
            <Field label={t('jobs.form.minExperienceYears')} value={minExperience} onChangeText={setMinExperience} keyboardType="number-pad" />

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { fontFamily: f.semibold }]}>{t('tags.skillsTags')}</Text>
              <Body muted>{t('jobs.form.skillsInfo')}</Body>
            </View>
            <SkillPicker selected={skills} onChange={setSkills} required={required} onRequiredChange={setRequiredFor} />

            <Field label={t('jobs.form.expiresAfterDays')} value={days} onChangeText={setDays} keyboardType="number-pad" />

            {error && <ErrorBox message={error} />}
            <Button
              title={jobId ? t('jobs.saveChanges') : t('jobs.createJob')}
              onPress={save}
              busy={saving}
              disabled={!title.trim()}
            />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, color: colors.ink, textAlign: 'left' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  form: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  multiline: { minHeight: 110, textAlignVertical: 'top', paddingTop: space.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH },
  label: { fontSize: 14, color: colors.gray[700] },
  pair: { flexDirection: 'row', gap: space.md },
  section: { gap: space.xs, marginTop: space.sm },
  aiBox: { gap: space.md, padding: space.md, borderRadius: 12, backgroundColor: colors.brandScale[50], borderWidth: 1, borderColor: colors.brandScale[200] },
  aiHint: { fontSize: 13, lineHeight: 19, color: colors.gray[700], textAlign: 'left' },
  aiNote: { fontSize: 13, color: colors.brandDark, textAlign: 'left' },
  sectionTitle: { fontSize: 16, color: colors.ink, textAlign: 'left' },
})
