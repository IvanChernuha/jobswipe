// Small building blocks in the Harbor style. Positions and sizes are easy to
// tweak here later; screens only compose these.
import type { ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts, radius, space, TOUCH } from '../lib/theme'

export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <SafeAreaView style={styles.screen} testID={testID}>
      {children}
    </SafeAreaView>
  )
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={[styles.title, { fontFamily: fonts().display }]}>{children}</Text>
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, { fontFamily: fonts().regular }, muted && styles.muted]}>{children}</Text>
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { fontFamily: fonts().medium }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.gray[400]}
        style={[styles.input, { fontFamily: fonts().regular }]}
        {...input}
      />
    </View>
  )
}

export function Button({
  title, onPress, busy, variant = 'primary',
}: { title: string; onPress: () => void; busy?: boolean; variant?: 'primary' | 'secondary' }) {
  const primary = variant === 'primary'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary, pressed && styles.pressed]}
    >
      {busy && <ActivityIndicator color={primary ? '#fff' : colors.brand} style={styles.spinner} />}
      <Text style={[styles.buttonText, { fontFamily: fonts().semibold }, !primary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  )
}

export function LinkText({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Text accessibilityRole="link" onPress={onPress} style={[styles.link, { fontFamily: fonts().semibold }]}>
      {children}
    </Text>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <Text style={[styles.errorText, { fontFamily: fonts().regular }]}>{message}</Text>
    </View>
  )
}

/** Two-or-more option picker (e.g. Worker / Employer). */
export function Choice<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={styles.choice}>
      {options.map((o) => {
        const checked = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.choiceItem, checked && styles.choiceItemOn]}
          >
            <Text style={[styles.choiceText, { fontFamily: fonts().semibold }, checked && styles.choiceTextOn]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  title: { fontSize: 30, color: colors.ink, textAlign: 'center' },
  body: { fontSize: 15, color: colors.ink, textAlign: 'center', lineHeight: 22 },
  muted: { color: colors.muted },
  field: { gap: space.xs },
  label: { fontSize: 14, color: colors.gray[700] },
  input: {
    minHeight: TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, fontSize: 16, color: colors.ink, backgroundColor: colors.surface,
  },
  button: {
    minHeight: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', paddingHorizontal: space.lg,
  },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.85 },
  spinner: { marginEnd: space.sm },
  buttonText: { fontSize: 16, color: '#fff' },
  secondaryText: { color: colors.ink },
  link: { color: colors.brand, fontSize: 15 },
  error: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md },
  errorText: { color: colors.danger, fontSize: 14 },
  choice: { flexDirection: 'row', gap: space.sm },
  choiceItem: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  choiceItemOn: { borderColor: colors.brand, backgroundColor: colors.brandScale[50] },
  choiceText: { fontSize: 15, color: colors.gray[700] },
  choiceTextOn: { color: colors.brandDark },
})
