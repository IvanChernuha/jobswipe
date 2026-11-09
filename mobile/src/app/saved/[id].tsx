import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getBookmarks, type SavedItem } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { savedToCard } from '../../lib/cards'
import ProfileDetails, { BackHeader } from '../../components/ProfileDetails'
import { ErrorBox, Screen } from '../../components/ui'
import { colors } from '../../lib/theme'

// A saved job or candidate in full. No CV here: that opens only after a match.
export default function SavedDetails() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session, role } = useAuth()
  const token = session?.access_token ?? ''

  const [item, setItem] = useState<SavedItem | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!token || !id) return
    getBookmarks(token)
      .then((groups) => {
        const found = groups.flatMap((g) => g.bookmarks).find((b) => b.target_id === id)
        if (found) setItem(found)
        else setFailed(true)
      })
      .catch(() => setFailed(true))
  }, [token, id])

  if (!item) {
    return (
      <Screen testID="screen-profile-details">
        <BackHeader title={t('nav.saved')} fallback="/saved" />
        <View style={styles.center}>
          {failed ? <ErrorBox message={t('mobile.loadFailed')} /> : <ActivityIndicator color={colors.brand} size="large" />}
        </View>
      </Screen>
    )
  }

  return <ProfileDetails card={savedToCard(item, role === 'employer')} fallback="/saved" />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
})
