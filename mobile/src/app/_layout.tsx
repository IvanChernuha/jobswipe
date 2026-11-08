import { useEffect, useState } from 'react'
import { I18nManager } from 'react-native'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { useAppFonts } from '../lib/fonts'
import i18n, { initialLanguage, LANGUAGES } from '../lib/i18n'
import '../lib/api' // configures the shared API client

SplashScreen.preventAutoHideAsync().catch(() => {})

function useLanguageReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    initialLanguage().then(async (code) => {
      await i18n.changeLanguage(code)
      const rtl = LANGUAGES.find((l) => l.code === code)!.rtl
      // Direction changes apply on the next start.
      if (rtl !== I18nManager.isRTL) {
        I18nManager.allowRTL(rtl)
        I18nManager.forceRTL(rtl)
      }
      setReady(true)
    })
  }, [])
  return ready
}

function RootNavigator() {
  const { session, loading } = useAuth()
  const fontsReady = useAppFonts()
  const languageReady = useLanguageReady()
  const ready = fontsReady && languageReady && !loading

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Logged out: only login and sign-up. */}
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
        </Stack.Protected>
        {/* Logged in: the app. */}
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="job/new" />
          <Stack.Screen name="job/[id]" />
          <Stack.Screen name="profile/edit" />
        </Stack.Protected>
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  )
}
