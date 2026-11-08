// The draggable top card with the next card waiting underneath. Dragging and
// the fly-off animation run on the UI thread (Reanimated), so it stays smooth.
import { useEffect } from 'react'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, {
  interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useTranslation } from 'react-i18next'
import { swipeDecision } from '@jobswipe/shared/feed'
import type { CardData } from '../lib/cards'
import SwipeCard from './SwipeCard'
import { colors, fonts, radius } from '../lib/theme'

interface Props {
  top: CardData | null
  next: CardData | null
  enabled: boolean
  /** Called once a drag is released past the threshold. */
  onSwipe: (dir: 'like' | 'pass') => void
}

export default function SwipeDeck({ top, next, enabled, onSwipe }: Props) {
  const { t } = useTranslation()
  const { width } = useWindowDimensions()
  const x = useSharedValue(0)
  const y = useSharedValue(0)

  // A new top card always starts centred.
  useEffect(() => {
    x.value = 0
    y.value = 0
  }, [top?.id, x, y])

  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-12, 12],
    onUpdate: (e) => {
      'worklet'
      x.value = e.translationX
      y.value = e.translationY * 0.3
    },
    onDeactivate: (e) => {
      'worklet'
      const dir = swipeDecision({ dx: e.translationX, vx: e.velocityX, width })
      if (dir) {
        x.value = withTiming(dir === 'like' ? width * 1.5 : -width * 1.5, { duration: 220 }, () => {
          scheduleOnRN(onSwipe, dir)
        })
      } else {
        x.value = withSpring(0)
        y.value = withSpring(0)
      }
    },
  })

  const topStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${interpolate(x.value, [-width, 0, width], [-14, 0, 14])}deg` },
    ],
  }))
  const likeStamp = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, width * 0.25], [0, 1], 'clamp') }))
  const nopeStamp = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-width * 0.25, 0], [1, 0], 'clamp') }))
  const nextStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(Math.abs(x.value), [0, width * 0.4], [0.95, 1], 'clamp') }],
  }))

  if (!top) return null
  const f = fonts()

  return (
    <View style={styles.deck}>
      {next && (
        <Animated.View key={next.id} style={[styles.layer, nextStyle]} importantForAccessibility="no-hide-descendants">
          <SwipeCard card={next} />
        </Animated.View>
      )}
      <GestureDetector gesture={pan}>
        <Animated.View key={top.id} style={[styles.layer, topStyle]}>
          <SwipeCard card={top} />
          <Animated.View style={[styles.stamp, styles.stampLike, likeStamp]} pointerEvents="none">
            <Text style={[styles.stampText, { color: colors.brand, fontFamily: f.semibold }]}>{t('swipeCard.like')}</Text>
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.stampNope, nopeStamp]} pointerEvents="none">
            <Text style={[styles.stampText, { color: colors.danger, fontFamily: f.semibold }]}>{t('swipeCard.nope')}</Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  deck: { flex: 1 },
  layer: StyleSheet.absoluteFill,
  stamp: { position: 'absolute', top: 40, borderWidth: 3, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 4 },
  stampLike: { start: 24, borderColor: colors.brand, transform: [{ rotate: '-14deg' }] },
  stampNope: { end: 24, borderColor: colors.danger, transform: [{ rotate: '14deg' }] },
  stampText: { fontSize: 30, letterSpacing: 2 },
})
