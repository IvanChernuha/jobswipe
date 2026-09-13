import { createClient } from '@supabase/supabase-js'

// Supabase is reached through the app's own origin at /supabase/* (Caddy
// proxies it to Kong), so the same build works on the LAN, through a tunnel,
// or on a real domain. VITE_SUPABASE_URL overrides this for hosted setups.
const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || `${window.location.origin}/supabase`

export const supabase = createClient(
  supabaseUrl,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)
