import { Image, StyleSheet, Text, View } from 'react-native'
import { mediaUrl } from '../lib/media'
import { colors, fonts } from '../lib/theme'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

/** Round photo, or the name's initials when there is none. */
export default function Avatar({ name, url, size = 52 }: { name: string; url?: string | null; size?: number }) {
  const uri = mediaUrl(url)
  const box = { width: size, height: size, borderRadius: size / 2 }
  if (uri) return <Image source={{ uri }} style={[styles.base, box]} accessibilityIgnoresInvertColors />
  return (
    <View style={[styles.base, styles.empty, box]}>
      <Text style={[styles.text, { fontFamily: fonts().semibold, fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.brandScale[100] },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandScale[400] },
  text: { color: '#fff' },
})
