/**
 * The "Connect Comeet" popup (user 2026-11-27): two boxes, UID and Token.
 * Sorts whatever was pasted (one value, both, labelled, or the API link) into
 * the right box. Same patterns as backend services/comeet.py
 * parse_credentials, which checks the pair again on Connect.
 */
const UID = /^[A-Za-z0-9]{1,4}\.[A-Za-z0-9]{2,6}$/
const TOKEN = /^[A-Za-z0-9]{16,}$/
const FROM_URL = /\/company\/([A-Za-z0-9.]+)\/positions\S*?[?&]token=([A-Za-z0-9]+)/

export interface ComeetPaste {
  uid: string | null
  token: string | null
}

export function readComeetPaste(text: string): ComeetPaste {
  const m = FROM_URL.exec(text ?? '')
  if (m) return { uid: m[1], token: m[2] }
  const words = (text ?? '').split(/[\s,;:=]+/)
  return {
    uid: words.find((w) => UID.test(w)) ?? null,
    token: words.find((w) => TOKEN.test(w) && !['token', 'company'].includes(w.toLowerCase())) ?? null,
  }
}
