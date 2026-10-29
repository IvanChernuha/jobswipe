// Every text must exist in every language, so no screen (web or mobile)
// ever shows a raw key. Plural forms differ per language (Hebrew has `_two`),
// so plural suffixes are compared by their base key.
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import he from '../locales/he.json'

const PLURAL = /_(zero|one|two|few|many|other)$/

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

function baseKeys(obj: Record<string, unknown>): Set<string> {
  return new Set(keys(obj).map((k) => k.replace(PLURAL, '')))
}

describe('translations', () => {
  it('Hebrew has every English text', () => {
    const missing = [...baseKeys(en)].filter((k) => !baseKeys(he).has(k))
    expect(missing).toEqual([])
  })

  it('English has every Hebrew text', () => {
    const missing = [...baseKeys(he)].filter((k) => !baseKeys(en).has(k))
    expect(missing).toEqual([])
  })

  it('no text is empty', () => {
    for (const [lang, dict] of Object.entries({ en, he })) {
      const flat = keys(dict)
      const get = (path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], dict)
      const empty = flat.filter((k) => typeof get(k) === 'string' && (get(k) as string).trim() === '')
      expect({ lang, empty }).toEqual({ lang, empty: [] })
    }
  })
})
