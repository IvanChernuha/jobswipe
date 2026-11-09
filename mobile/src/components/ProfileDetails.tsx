import type { ReactNode } from 'react'
import { I18nManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import type { CardData } from '../lib/cards'
import Avatar from './Avatar'
import { Screen } from './ui'
import { colors, fonts, radius, space, TOUCH } from '../lib/theme'

/** Back arrow + title, for screens opened on top of the tabs. */
export function BackHeader({ title, fallback }: { title: string; fallback: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const back = () => (router.canGoBack() ? router.back() : router.replace(fallback as never))
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={back} style={styles.iconButton}>
        <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.ink} />
      </Pressable>
      <Text style={[styles.headerTitle, { fontFamily: fonts().semibold }]} numberOfLines={1}>{title}</Text>
    </View>
  )
}

/**
 * Everything on a card, nothing cut off: the full description or bio, every
 * skill (must-haves marked), and for jobs the company. `children` go at the
 * bottom (e.g. Open CV, Chat).
 */
export default function ProfileDetails({
  card, companyAbout, fallback, children,
}: { card: CardData; companyAbout?: string; fallback: string; children?: ReactNode }) {
  const { t } = useTranslation()
  const f = fonts()
  return (
    <Screen testID="screen-profile-details">
      <BackHeader title={card.kind === 'job' ? card.name : card.headline} fallback={fallback} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar name={card.name || card.headline} url={card.avatarUrl} size={88} />
          <Text style={[styles.headline, { fontFamily: f.display }]}>{card.headline}</Text>
          {!!card.subtitle && <Text style={[styles.subtitle, { fontFamily: f.medium }]}>{card.subtitle}</Text>}
          <View style={styles.facts}>
            {!!card.location && (
              <View style={styles.fact}>
                <Ionicons name="location-outline" size={16} color={colors.muted} />
                <Text style={[styles.factText, { fontFamily: f.regular }]}>{card.location}</Text>
              </View>
            )}
            {!!card.salary && (
              <View style={styles.fact}>
                <Ionicons name="cash-outline" size={16} color={colors.muted} />
                <Text style={[styles.factText, { fontFamily: f.regular }]}>{card.salary}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { fontFamily: f.semibold }]}>{t('mobile.about')}</Text>
          <Text style={[styles.body, { fontFamily: f.regular }]}>{card.about?.trim() || t('swipeCard.noDescription')}</Text>
        </View>

        {card.tags.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontFamily: f.semibold }]}>{t('tags.skillsTags')}</Text>
            <View style={styles.tags}>
              {card.tags.map((tag) => (
                <View key={tag.id} style={[styles.tag, tag.requirement === 'required' && styles.tagRequired]}>
                  {tag.requirement === 'required' && <Ionicons name="star" size={12} color={colors.brandDark} />}
                  <Text style={[styles.tagText, { fontFamily: f.medium }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
            {card.tags.some((tag) => tag.requirement === 'required') && (
              <View style={styles.legend}>
                <Ionicons name="star" size={12} color={colors.muted} />
                <Text style={[styles.legendText, { fontFamily: f.regular }]}>{t('mobile.mustHave')}</Text>
              </View>
            )}
          </View>
        )}

        {!!companyAbout?.trim() && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { fontFamily: f.semibold }]}>{t('mobile.aboutCompany')}</Text>
            <Text style={[styles.body, { fontFamily: f.regular }]}>{companyAbout}</Text>
          </View>
        )}

        {children && <View style={styles.actions}>{children}</View>}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, color: colors.ink, textAlign: 'left' },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  identity: { alignItems: 'center', gap: space.xs, paddingVertical: space.md },
  headline: { fontSize: 26, color: colors.ink, textAlign: 'center', marginTop: space.sm },
  subtitle: { fontSize: 16, color: colors.gray[600], textAlign: 'center' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.lg, marginTop: space.xs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  factText: { fontSize: 15, color: colors.muted },
  section: {
    gap: space.sm, padding: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: { fontSize: 15, color: colors.ink, textAlign: 'left' },
  body: { fontSize: 15, lineHeight: 23, color: colors.gray[700], textAlign: 'left' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandScale[50],
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.full,
  },
  tagRequired: { backgroundColor: colors.brandScale[100], borderWidth: 1, borderColor: colors.brandScale[300] },
  tagText: { fontSize: 14, color: colors.brandDark },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 12, color: colors.muted },
  actions: { gap: space.md },
})
