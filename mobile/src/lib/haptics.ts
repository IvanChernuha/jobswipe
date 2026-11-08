// Small vibrations on like / match. Never allowed to break the action they
// decorate (some phones have no vibration motor, or it's switched off).
import * as Haptics from 'expo-haptics'

function safe(fn: () => Promise<void> | undefined) {
  try {
    Promise.resolve(fn()).catch(() => {})
  } catch {
    // ignore
  }
}

export const haptic = {
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
}
