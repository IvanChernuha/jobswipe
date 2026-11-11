// Server addresses, baked in at build time (scripts/mobile/build-android.sh
// sets EXPO_PUBLIC_*). Until the domain exists they point at the tunnel.
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? ''

export const config = {
  apiUrl,
  /** The website (same host as the API), for links people open in a browser, e.g. team invites. */
  webUrl: apiUrl.replace(/\/api\/?$/, ''),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
}
