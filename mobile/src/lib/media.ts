import { config } from './config'

/** Photos come back as server paths ('/supabase/...'); the phone needs a full URL. */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  const host = config.apiUrl.replace(/\/api\/?$/, '')
  return host ? `${host}${url.startsWith('/') ? '' : '/'}${url}` : null
}
