import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getEmployerProfile, getWorkerProfile, type EmployerProfile, type WorkerProfile } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../../components/Avatar'
import LanguageSwitch from '../../components/LanguageSwitch'
import { Body, Button, ErrorBox, Screen } from '../../components/ui'
import { colors, fonts, radius, space } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'

// The web Profile.tsx, read-only here; "Edit profile" opens the form. Photo,
// CV, data export and account deletion come in a later step.
export default function Profile() {
  const { t } = useTranslation()
  const router = useRouter()
  const { session, role, signOut } = useAuth()
  const token = session?.access_token ?? ''
  const employer = role === 'employer'

  const [worker, setWorker] = useState<WorkerProfile | null>(null)
  const [company, setCompany] = useState<EmployerProfile | null>(null)
  const [load, setLoad] = useState<Load>('loading')

  // Reload whenever the tab is opened, e.g. after editing.
  useFocusEffect(
    useCallback(() => {
      if (!token) return
      const fetch = employer ? getEmployerProfile(token).then(setCompany) : getWorkerProfile(token).then(setWorker)
      fetch.then(() => setLoad('ready')).catch(() => setLoad('error'))
    }, [token, employer]),
  )

  const f = fonts()
  const edit = () => router.push('/profile/edit')

  let name = ''
  let subtitle = ''
  let about = ''
  let avatar: string | null = null
  let empty = false
  if (worker) {
    name = worker.name
    subtitle = [worker.location, worker.experience_years ? t('matches.yrsExp', { count: worker.experience_years }) : '']
      .filter(Boolean).join(' · ')
    about = worker.bio
    avatar = worker.avatar_url
    empty = !worker.name && !worker.bio && worker.tags.length === 0
  }
  if (company) {
    name = company.company_name
    subtitle = [company.industry, company.location].filter(Boolean).join(' · ')
    about = company.description
    avatar = company.avatar_url
    empty = !company.company_name && !company.description
  }
  const fallback = employer ? t('profile.companyProfile') : t('profile.yourProfile')

  return (
    <Screen testID="screen-profile">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {load === 'loading' && <ActivityIndicator color={colors.brand} size="large" />}
          {load === 'error' && <ErrorBox message={t('profile.failedToLoad')} />}
          {load === 'ready' && (
            <>
              <View style={styles.identity}>
                <Avatar name={name || fallback} url={avatar} size={72} />
                <View style={styles.flex}>
                  <Text style={[styles.name, { fontFamily: f.display }]} numberOfLines={2}>{name || fallback}</Text>
                  {!!subtitle && <Text style={[styles.subtitle, { fontFamily: f.regular }]}>{subtitle}</Text>}
                </View>
              </View>
              {empty && <Body muted>{employer ? t('mobile.emptyProfileEmployer') : t('mobile.emptyProfileWorker')}</Body>}
              {!!about && <Text style={[styles.about, { fontFamily: f.regular }]}>{about}</Text>}
              {worker && worker.tags.length > 0 && (
                <View style={styles.tags}>
                  {worker.tags.map((s) => (
                    <View key={s.id} style={styles.tag}>
                      <Text style={[styles.tagText, { fontFamily: f.medium }]}>{s.name}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Button title={t('mobile.editProfile')} variant={empty ? 'primary' : 'secondary'} onPress={edit} />
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={[styles.section, { fontFamily: f.semibold }]}>{t('mobile.account')}</Text>
          <View style={styles.block}>
            <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('mobile.signedInAs')}</Text>
            <Text style={[styles.value, { fontFamily: f.medium }]}>{session?.user.email ?? ''}</Text>
            {role && (
              <Text style={[styles.muted, { fontFamily: f.regular }]}>
                {t(role === 'employer' ? 'register.employer' : 'register.worker')}
              </Text>
            )}
          </View>
          <View style={styles.block}>
            <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('common.language')}</Text>
            <LanguageSwitch />
          </View>
          <Button title={t('nav.signOut')} variant="secondary" onPress={signOut} />
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.lg },
  card: { padding: space.lg, gap: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  name: { fontSize: 24, color: colors.ink, textAlign: 'left' },
  subtitle: { fontSize: 14, color: colors.gray[600], textAlign: 'left', marginTop: 2 },
  about: { fontSize: 15, lineHeight: 22, color: colors.ink, textAlign: 'left' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.full, backgroundColor: colors.brandScale[50] },
  tagText: { fontSize: 13, color: colors.brandDark },
  section: { fontSize: 16, color: colors.ink, textAlign: 'left' },
  block: { gap: space.xs, alignItems: 'flex-start' },
  muted: { fontSize: 13, color: colors.muted },
  value: { fontSize: 15, color: colors.ink },
})
