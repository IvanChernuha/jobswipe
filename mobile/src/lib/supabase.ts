import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'
import { config } from './config'
import { secureSessionStorage } from './secureStorage'

// Same Supabase project and accounts as the web.
export const supabase = createClient(config.supabaseUrl || 'http://not-configured', config.supabaseAnonKey || 'none', {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Refresh the session only while the app is in the foreground (Supabase's
// recommendation for React Native).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
