// The Harbor design tokens live in one place and the web's Tailwind config
// uses them, so web and mobile can't drift apart.
import { describe, expect, it } from 'vitest'
import { colors, fonts } from '..'
// @ts-expect-error: plain JS config, no type declarations
import tailwindConfig from '../../../../../frontend/tailwind.config.js'

describe('Harbor tokens', () => {
  it('has the Harbor palette', () => {
    expect(colors.brand[500]).toBe('#0E7C7B') // teal
    expect(colors.gray[50]).toBe('#F5F1EA') // ivory ground
    expect(colors.gray[900]).toBe('#14213D') // navy ink
    expect(Object.keys(colors.brand)).toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'])
    expect(Object.keys(colors.gray)).toEqual(Object.keys(colors.brand))
  })

  it('has the Harbor fonts, with Hebrew siblings', () => {
    expect(fonts.sans[0]).toBe('IBM Plex Sans')
    expect(fonts.sans).toContain('IBM Plex Sans Hebrew')
    expect(fonts.display[0]).toBe('Fraunces')
    expect(fonts.display).toContain('Frank Ruhl Libre')
  })

  it('is what the web Tailwind config uses', () => {
    const ext = tailwindConfig.theme.extend
    expect(ext.colors.brand).toEqual(colors.brand)
    expect(ext.colors.gray).toEqual(colors.gray)
    expect(ext.fontFamily.sans).toEqual(fonts.sans.map((f: string) => (f.includes(' ') ? `"${f}"` : f)))
    expect(ext.fontFamily.display).toEqual(fonts.display.map((f: string) => (f.includes(' ') ? `"${f}"` : f)))
  })
})
