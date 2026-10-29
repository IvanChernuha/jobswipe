import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage, type LangCode } from '../lib/i18n'
import { colors, fonts, radius, space } from '../lib/theme'

/** EN / עב toggle. Switching direction (LTR <-> RTL) asks for an app restart. */
export default function LanguageSwitch() {
  const { t, i18n } = useTranslation()

  async function choose(code: LangCode) {
    if (code === i18n.language) return
    const { needsRestart } = await setLanguage(code)
    if (needsRestart) Alert.alert(t('mobile.restartTitle'), t('mobile.restartBody'), [{ text: t('mobile.ok') }])
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} style={styles.row}>
      {LANGUAGES.map((l) => {
        const on = i18n.language === l.code
        return (
          <Pressable
            key={l.code}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={l.label}
            onPress={() => choose(l.code)}
            style={[styles.item, on && styles.itemOn]}
            hitSlop={8}
          >
            <Text style={[styles.text, { fontFamily: fonts().semibold }, on && styles.textOn]}>
              {l.code === 'he' ? 'עב' : 'EN'}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.xs, backgroundColor: colors.gray[100], borderRadius: radius.full, padding: 3 },
  item: { paddingHorizontal: space.md, paddingVertical: space.xs + 2, borderRadius: radius.full },
  itemOn: { backgroundColor: colors.surface },
  text: { fontSize: 13, color: colors.muted },
  textOn: { color: colors.ink },
})
