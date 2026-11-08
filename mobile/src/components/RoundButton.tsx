import { Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../lib/theme'

type IconName = keyof typeof Ionicons.glyphMap

/** Feed action button: a round icon button with a spoken label. */
export default function RoundButton({
  icon, label, color, size = 'md', disabled, onPress,
}: { icon: IconName; label: string; color: string; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; onPress: () => void }) {
  const d = size === 'lg' ? 68 : size === 'md' ? 58 : 48
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn, { width: d, height: d, borderRadius: d / 2 },
        pressed && styles.pressed, disabled && styles.disabled,
      ]}
    >
      <Ionicons name={icon} size={d * 0.45} color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.ink, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  pressed: { transform: [{ scale: 0.92 }] },
  disabled: { opacity: 0.35 },
})
