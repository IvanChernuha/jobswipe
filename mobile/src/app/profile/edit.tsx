import { useEffect, useState } from 'react'
import { ActivityIndicator, I18nManager, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import {
  getEmployerProfile, getWorkerProfile, updateEmployerProfile, updateWorkerProfile, type Tag,
} from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import SkillPicker from '../../components/SkillPicker'
import { Button, ErrorBox, Field, Screen } from '../../components/ui'
import { colors, fonts, space, TOUCH } from '../../lib/theme'

// Workers: name, location, experience, bio, skills. Employers: the company.
export default function EditProfile() {
  const { t } = useTranslation()
  const router = useRouter()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''
  const employer = role === 'employer'

  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [about, setAbout] = useState('')
  const [experience, setExperience] = useState('')
  const [industry, setIndustry] = useState('')
  const [skills, setSkills] = useState<Tag[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    const load = employer
      ? getEmployerProfile(token).then((c) => {
          setName(c.company_name ?? '')
          setIndustry(c.industry ?? '')
          setLocation(c.location ?? '')
          setAbout(c.description ?? '')
        })
      : getWorkerProfile(token).then((w) => {
          setName(w.name ?? '')
          setLocation(w.location ?? '')
          setAbout(w.bio ?? '')
          setExperience(w.experience_years ? String(w.experience_years) : '')
          setSkills(w.tags ?? [])
        })
    load
      .catch(() => setError(t('profile.failedToLoad')))
      .finally(() => setLoading(false))
  }, [token, employer, t])

  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'))

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (employer) {
        await updateEmployerProfile(token, {
          company_name: name.trim(), industry: industry.trim(), location: location.trim(), description: about.trim(),
        })
      } else {
        await updateWorkerProfile(token, {
          name: name.trim(), location: location.trim(), experience_years: Number(experience.replace(/[^\d]/g, '')) || 0,
          bio: about.trim(), tag_ids: skills.map((s) => s.id),
        })
      }
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const f = fonts()

  return (
    <Screen testID="screen-profile-edit">
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={back} style={styles.iconButton}>
            <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.ink} />
          </Pressable>
          <Text style={[styles.headerTitle, { fontFamily: f.semibold }]}>{t('mobile.editProfile')}</Text>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {employer ? (
              <>
                <Field label={t('onboarding.employer.companyName')} value={name} onChangeText={setName} maxLength={200} />
                <Field label={t('onboarding.employer.industry')} value={industry} onChangeText={setIndustry} />
                <Field label={t('common.location')} value={location} onChangeText={setLocation} />
                <Field label={t('common.description')} value={about} onChangeText={setAbout} multiline style={styles.multiline} />
              </>
            ) : (
              <>
                <Field label={t('onboarding.worker.fullName')} value={name} onChangeText={setName} maxLength={200} autoComplete="name" />
                <Field label={t('common.location')} value={location} onChangeText={setLocation} />
                <Field label={t('onboarding.worker.yearsExperience')} value={experience} onChangeText={setExperience} keyboardType="number-pad" />
                <Field label={t('profile.bio')} value={about} onChangeText={setAbout} multiline style={styles.multiline} />
                <Text style={[styles.sectionTitle, { fontFamily: f.semibold }]}>{t('tags.skillsTags')}</Text>
                <SkillPicker selected={skills} onChange={setSkills} />
              </>
            )}
            {error && <ErrorBox message={error} />}
            <Button title={t('profile.saveChanges')} onPress={save} busy={saving} />
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
  sectionTitle: { fontSize: 16, color: colors.ink, textAlign: 'left', marginTop: space.sm },
})
