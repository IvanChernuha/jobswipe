import { Image, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import type { CardData } from '../lib/cards'
import { mediaUrl } from '../lib/media'
import { colors, fonts, radius, space } from '../lib/theme'

const MAX_TAGS = 6

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
}

function matchColor(pct: number) {
  if (pct >= 70) return colors.brand
  if (pct >= 40) return '#B7791F'
  return colors.gray[500]
}

/** One feed card: a job (worker feed) or a candidate (employer feed). */
export default function SwipeCard({ card }: { card: CardData }) {
  const { t } = useTranslation()
  const f = fonts()
  const photo = mediaUrl(card.avatarUrl)
  const shownTags = card.tags.slice(0, MAX_TAGS)
  const extra = card.tags.length - shownTags.length
  const showMatch = card.match && card.match.total > 0

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatar} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <Text style={[styles.initials, { fontFamily: f.semibold }]}>{initials(card.name)}</Text>
          </View>
        )}
        {showMatch && (
          <View style={[styles.match, { backgroundColor: matchColor(card.match!.percentage) }]}>
            <View style={styles.matchRow}>
              <Text style={[styles.matchPct, { fontFamily: f.semibold }]}>{card.match!.percentage}%</Text>
              <Text style={[styles.matchWord, { fontFamily: f.regular }]}>{t('swipeCard.match')}</Text>
            </View>
            {card.match!.job_title ? (
              <Text numberOfLines={1} style={[styles.matchJob, { fontFamily: f.regular }]}>
                {t('swipeCard.forJob', { title: card.match!.job_title })}
              </Text>
            ) : null}
          </View>
        )}
        {card.liked && (
          <View style={[styles.liked, card.liked === 'super_like' && styles.superLiked]}>
            <Ionicons name={card.liked === 'super_like' ? 'star' : 'heart'} size={14} color="#fff" />
            <Text style={[styles.likedText, { fontFamily: f.semibold }]}>
              {card.liked === 'super_like' ? t('mobile.superLikedYou') : t('mobile.likedYou')}
            </Text>
          </View>
        )}
        <Text style={[styles.kind, { fontFamily: f.semibold }]}>
          {card.kind === 'job' ? t('swipeCard.job') : t('swipeCard.candidate')}
        </Text>
      </View>

      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.headline, { fontFamily: f.display }]}>{card.headline}</Text>
        <Text numberOfLines={1} style={[styles.subtitle, { fontFamily: f.medium }]}>{card.subtitle}</Text>

        <View style={styles.facts}>
          {card.location ? (
            <View style={styles.fact}>
              <Ionicons name="location-outline" size={16} color={colors.muted} />
              <Text style={[styles.factText, { fontFamily: f.regular }]}>{card.location}</Text>
            </View>
          ) : null}
          {card.salary ? (
            <View style={styles.fact}>
              <Ionicons name="cash-outline" size={16} color={colors.muted} />
              <Text style={[styles.factText, { fontFamily: f.regular }]}>{card.salary}</Text>
            </View>
          ) : null}
        </View>

        {shownTags.length > 0 && (
          <View style={styles.tags}>
            {shownTags.map((tag) => (
              <View key={tag.id} style={[styles.tag, tag.requirement === 'required' && styles.tagRequired]}>
                <Text style={[styles.tagText, { fontFamily: f.medium }]}>{tag.name}</Text>
              </View>
            ))}
            {extra > 0 && (
              <Text style={[styles.more, { fontFamily: f.regular }]}>{t('swipeCard.plusMore', { count: extra })}</Text>
            )}
          </View>
        )}

        <Text numberOfLines={4} style={[styles.about, { fontFamily: f.regular }]}>
          {card.about?.trim() || t('swipeCard.noDescription')}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden',
    shadowColor: colors.ink, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  header: { height: 170, backgroundColor: colors.brandScale[600], alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 104, height: 104, borderRadius: 52, borderWidth: 3, borderColor: '#fff' },
  avatarEmpty: { backgroundColor: colors.brandScale[400], alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 36, color: '#fff' },
  match: { position: 'absolute', top: space.md, start: space.md, paddingHorizontal: space.md, paddingVertical: space.xs + 2, borderRadius: radius.lg, maxWidth: '70%' },
  matchRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  matchPct: { fontSize: 18, color: '#fff' },
  matchWord: { fontSize: 13, color: '#fff' },
  matchJob: { fontSize: 12, color: '#fff', opacity: 0.95 },
  kind: {
    position: 'absolute', top: space.md, end: space.md, fontSize: 11, color: '#fff', letterSpacing: 0.6,
    textTransform: 'uppercase', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden',
  },
  liked: {
    position: 'absolute', bottom: space.md, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.full, backgroundColor: '#E0457B',
  },
  superLiked: { backgroundColor: '#2F6FD6' },
  likedText: { fontSize: 13, color: '#fff' },
  body: { flex: 1, padding: space.xl, gap: space.sm },
  headline: { fontSize: 26, color: colors.ink, lineHeight: 32 },
  subtitle: { fontSize: 16, color: colors.gray[600] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.xs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  factText: { fontSize: 15, color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  tag: { backgroundColor: colors.brandScale[50], paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.full },
  tagRequired: { backgroundColor: colors.brandScale[100] },
  tagText: { fontSize: 14, color: colors.brandDark },
  more: { fontSize: 14, color: colors.muted, alignSelf: 'center' },
  about: { fontSize: 15, color: colors.gray[700], lineHeight: 22, marginTop: space.sm },
})
