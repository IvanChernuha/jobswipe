import { useEffect } from 'react'

type SwipeDirection = 'like' | 'pass'

/**
 * Listens to keyboard events:
 *   V / v  → like
 *   X / x  → pass
 *
 * Cleans up the listener automatically on unmount.
 *
 * @param onSwipe - called with the resolved direction
 * @param enabled - set to false to pause listening (e.g. while a modal is open)
 */
export function useSwipe(
  onSwipe: (direction: SwipeDirection) => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when focus is in a text field
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const key = e.key.toLowerCase()
      if (key === 'v') onSwipe('like')
      else if (key === 'x') onSwipe('pass')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSwipe, enabled])
}
