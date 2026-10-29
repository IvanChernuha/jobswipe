// Server addresses, baked in at build time (scripts/mobile/build-android.sh
// sets EXPO_PUBLIC_*). Until the domain exists they point at the tunnel.
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
}
