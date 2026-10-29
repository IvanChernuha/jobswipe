// Mobile theme: the shared Harbor tokens plus native font names and spacing.
import { I18nManager } from 'react-native'
import { colors as shared } from '@jobswipe/shared/theme'

export const colors = {
  brandScale: shared.brand,
  gray: shared.gray,
  ground: shared.gray[50],
  surface: '#FFFFFF',
  ink: shared.gray[900],
  muted: shared.gray[500],
  border: shared.gray[200],
  brand: shared.brand[500],
  brandDark: shared.brand[700],
  danger: '#B42318',
  dangerBg: '#FEF3F2',
}

/** Native font family names (loaded in lib/fonts). Hebrew layout uses the Hebrew siblings. */
export function fonts() {
  const he = I18nManager.isRTL
  return {
    regular: he ? 'IBMPlexSansHebrew_400Regular' : 'IBMPlexSans_400Regular',
    medium: he ? 'IBMPlexSansHebrew_500Medium' : 'IBMPlexSans_500Medium',
    semibold: he ? 'IBMPlexSansHebrew_600SemiBold' : 'IBMPlexSans_600SemiBold',
    display: he ? 'FrankRuhlLibre_700Bold' : 'Fraunces_700Bold',
  }
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const radius = { md: 12, lg: 16, xl: 24, full: 999 }
/** Minimum touch target (accessibility). */
export const TOUCH = 48
