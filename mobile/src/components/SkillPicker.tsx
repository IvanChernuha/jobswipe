import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { getTags, type Tag } from '../lib/api'
import { colors, fonts, radius, space, TOUCH } from '../lib/theme'

const MAX_RESULTS = 8

/**
 * Search the skill list and pick skills (the web TagPicker, phone-sized).
 * With `required`, each chosen skill gets a Must-have switch (job postings).
 */
export default function SkillPicker({
  selected, onChange, required, onRequiredChange,
}: {
  selected: Tag[]
  onChange: (tags: Tag[]) => void
  required?: Set<string>
  onRequiredChange?: (tagId: string, on: boolean) => void
}) {
  const { t } = useTranslation()
  const [all, setAll] = useState<Tag[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    getTags().then(setAll).catch(() => {})
  }, [])

  const chosen = new Set(selected.map((s) => s.id))
  const q = search.trim().toLowerCase()
  const results = q ? all.filter((s) => !chosen.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS) : []
  const f = fonts()

  const add = (tag: Tag) => {
    onChange([...selected, tag])
    setSearch('')
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.gray[400]} />
        <TextInput
          accessibilityLabel={t('tags.searchPlaceholder')}
          placeholder={t('tags.searchPlaceholder')}
          placeholderTextColor={colors.gray[400]}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.search, { fontFamily: f.regular }]}
        />
      </View>

      {!!q && (
        <View style={styles.results}>
          {results.length === 0 && <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('tags.noMatching')}</Text>}
          {results.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={s.name}
              onPress={() => add(s)}
              style={({ pressed }) => [styles.result, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={16} color={colors.brandDark} />
              <Text style={[styles.resultText, { fontFamily: f.medium }]}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {selected.length === 0 && !q && (
        <Text style={[styles.muted, { fontFamily: f.regular }]}>{t('mobile.noSkillsYet')}</Text>
      )}
      {selected.map((s) => (
        <View key={s.id} style={styles.chosen}>
          <Text style={[styles.chosenName, { fontFamily: f.semibold }]} numberOfLines={1}>{s.name}</Text>
          {onRequiredChange && (
            <View style={styles.must}>
              <Text style={[styles.mustText, { fontFamily: f.regular }]}>{t('mobile.mustHave')}</Text>
              <Switch
                accessibilityLabel={t('mobile.mustHaveFor', { name: s.name })}
                value={!!required?.has(s.id)}
                onValueChange={(on) => onRequiredChange(s.id, on)}
                trackColor={{ true: colors.brand, false: colors.gray[300] }}
                thumbColor="#fff"
              />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.removeSkill', { name: s.name })}
            onPress={() => onChange(selected.filter((x) => x.id !== s.id))}
            hitSlop={6}
            style={styles.remove}
          >
            <Ionicons name="close" size={20} color={colors.gray[500]} />
          </Pressable>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
  },
  search: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: space.sm },
  results: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: space.md,
    borderRadius: radius.full, backgroundColor: colors.brandScale[50], borderWidth: 1, borderColor: colors.brandScale[200],
  },
  resultText: { fontSize: 14, color: colors.brandDark },
  pressed: { opacity: 0.7 },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'left' },
  chosen: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, paddingStart: space.md,
    borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chosenName: { flex: 1, fontSize: 15, color: colors.ink, textAlign: 'left' },
  must: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mustText: { fontSize: 13, color: colors.gray[600] },
  remove: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
})
