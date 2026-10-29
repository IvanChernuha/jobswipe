import { useFonts } from 'expo-font'
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces'
import { FrankRuhlLibre_700Bold } from '@expo-google-fonts/frank-ruhl-libre'
import {
  IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans'
import {
  IBMPlexSansHebrew_400Regular, IBMPlexSansHebrew_500Medium, IBMPlexSansHebrew_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans-hebrew'

/** Harbor fonts (packages/shared theme), each with its Hebrew sibling. True once loaded (or failed: fall back to system). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Fraunces_600SemiBold, Fraunces_700Bold, FrankRuhlLibre_700Bold,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold,
    IBMPlexSansHebrew_400Regular, IBMPlexSansHebrew_500Medium, IBMPlexSansHebrew_600SemiBold,
  })
  return loaded || !!error
}
