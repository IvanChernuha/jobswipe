import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { File, Paths } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import * as Sharing from 'expo-sharing'
import {
  deleteMyAccount, exportMyData, getEmployerProfile, getWorkerProfile, uploadAvatar,
  type EmployerProfile, type WorkerProfile,
} from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../../components/Avatar'
import FeedbackCard from '../../components/FeedbackCard'
import LanguageSwitch from '../../components/LanguageSwitch'
import { Body, Button, ErrorBox, Field, Screen } from '../../components/ui'
import { colors, fonts, radius, space, TOUCH } from '../../lib/theme'

type Load = 'loading' | 'ready' | 'error'

// The web Profile.tsx: your profile ("Edit profile" opens the form), photo,
// language, sign out, and Data & Privacy (download your data, delete the
// account). CV upload comes with the AI step.
export default function Profile() {
  const { t } = useTranslation()
  const router = useRouter()
  const { session, role, signOut } = useAuth()
  const token = session?.access_token ?? ''
  const employer = role === 'employer'

  const [worker, setWorker] = useState<WorkerProfile | null>(null)
  const [company, setCompany] = useState<EmployerProfile | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  async function changePhoto() {
    const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
    if (pick.canceled || !pick.assets?.length) return
    const photo = pick.assets[0]
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const { url } = await uploadAvatar(token, { uri: photo.uri, name: photo.fileName ?? 'photo.jpg', type: photo.mimeType ?? 'image/jpeg' })
      if (employer) setCompany((c) => (c ? { ...c, avatar_url: url } : c))
      else setWorker((w) => (w ? { ...w, avatar_url: url } : w))
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t('profile.uploadFailed'))
    } finally {
      setPhotoBusy(false)
    }
  }

  /** Everything we hold about you, as a JSON file you can save or send. */
  async function downloadData() {
    setExporting(true)
    setExportError(false)
    try {
      const data = await exportMyData(token)
      const file = new File(Paths.cache, 'jobswipe-my-data.json')
      file.create({ overwrite: true })
      await file.write(JSON.stringify(data, null, 2))
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: t('profile.downloadYourData') })
    } catch {
      setExportError(true)
    } finally {
      setExporting(false)
    }
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteMyAccount(token)
      await signOut()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('mobile.loadFailed'))
      setDeleting(false)
    }
  }

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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.changePhoto')}
                  onPress={changePhoto}
                  disabled={photoBusy}
                  style={styles.photo}
                >
                  <Avatar name={name || fallback} url={avatar} size={72} />
                  <View style={styles.photoBadge}>
                    {photoBusy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
                  </View>
                </Pressable>
                <View style={styles.flex}>
                  <Text style={[styles.name, { fontFamily: f.display }]} numberOfLines={2}>{name || fallback}</Text>
                  {!!subtitle && <Text style={[styles.subtitle, { fontFamily: f.regular }]}>{subtitle}</Text>}
                </View>
              </View>
              {photoError && <ErrorBox message={photoError} />}
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

        <FeedbackCard token={token} />

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

        <View style={styles.card}>
          <Text style={[styles.section, { fontFamily: f.semibold }]}>{t('profile.dataPrivacy')}</Text>
          <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('profile.downloadYourDataHint')}</Text>
          <Button title={t('profile.downloadMyData')} variant="secondary" onPress={downloadData} busy={exporting} />
          {exportError && <ErrorBox message={t('mobile.loadFailed')} />}

          <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('profile.deleteAccountHint')}</Text>
          {confirmText === null ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmText('')}
              style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
            >
              <Text style={[styles.dangerText, { fontFamily: f.semibold }]}>{t('profile.deleteAccount')}</Text>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <Body>{t('profile.confirmDelete1')}</Body>
              <Field
                label={t('mobile.typeDelete')} value={confirmText} onChangeText={setConfirmText}
                autoCapitalize="none" autoCorrect={false}
              />
              {deleteError && <ErrorBox message={deleteError} />}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmText.trim().toLowerCase() !== 'delete' || deleting, busy: deleting }}
                disabled={confirmText.trim().toLowerCase() !== 'delete' || deleting}
                onPress={deleteAccount}
                style={[styles.dangerButton, styles.dangerSolid, confirmText.trim().toLowerCase() !== 'delete' && styles.off]}
              >
                <Text style={[styles.dangerText, styles.dangerSolidText, { fontFamily: f.semibold }]}>
                  {deleting ? t('profile.deletingEllipsis') : t('profile.deleteMyAccount')}
                </Text>
              </Pressable>
              <Button title={t('common.cancel')} variant="secondary" onPress={() => { setConfirmText(null); setDeleteError(null) }} />
            </View>
          )}
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
  photo: { position: 'relative' },
  photoBadge: {
    position: 'absolute', bottom: 0, end: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  dangerButton: {
    minHeight: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.danger, paddingHorizontal: space.lg,
  },
  dangerSolid: { backgroundColor: colors.danger },
  dangerText: { fontSize: 16, color: colors.danger },
  dangerSolidText: { color: '#fff' },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  confirm: { gap: space.md },
})
