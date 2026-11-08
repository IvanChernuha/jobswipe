import { useEffect, useRef } from 'react'

/**
 * Calls `fn` every `ms` while the screen is open (and `enabled`). Always calls
 * the latest `fn`, so re-renders don't restart the timer.
 */
export function usePolling(fn: () => void, ms: number, enabled = true): void {
  const latest = useRef(fn)
  latest.current = fn

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => latest.current(), ms)
    return () => clearInterval(timer)
  }, [ms, enabled])
}
