import type { ColorValue } from 'react-native'
import { Redirect, Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { colors, fonts } from '../../lib/theme'

type IconName = keyof typeof Ionicons.glyphMap

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  )
}

export const unstable_settings = { anchor: 'feed' }

// Same tabs as the web's phone tab bar (frontend/src/components/Navbar.tsx).
export default function TabsLayout() {
  const { t } = useTranslation()
  const { role, isNewAccount } = useAuth()
  if (isNewAccount) return <Redirect href="/onboarding" />
  const employer = role === 'employer'

  return (
    <Tabs
      // Android back from any tab returns to the feed first.
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts().medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="feed" options={{ title: t('nav.feed'), tabBarIcon: icon('compass-outline') }} />
      <Tabs.Screen name="jobs" options={{ title: t('nav.jobs'), tabBarIcon: icon('clipboard-outline'), href: employer ? undefined : null }} />
      <Tabs.Screen name="team" options={{ title: t('nav.team'), tabBarIcon: icon('people-outline'), href: employer ? undefined : null }} />
      <Tabs.Screen name="saved" options={{ title: t('nav.saved'), tabBarIcon: icon('bookmark-outline') }} />
      <Tabs.Screen name="matches" options={{ title: t('nav.matches'), tabBarIcon: icon('chatbubbles-outline') }} />
      <Tabs.Screen
        name="profile"
        options={{ title: t('nav.profile'), tabBarIcon: icon(employer ? 'business-outline' : 'person-outline') }}
      />
    </Tabs>
  )
}
