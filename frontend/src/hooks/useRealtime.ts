import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Match } from '../lib/api'

/**
 * Subscribes to Supabase Realtime for new match events.
 * Calls `onMatch` whenever the current user is part of a newly inserted match.
 *
 * @param userId   - the authenticated user's id (subscribe only when truthy)
 * @param onMatch  - callback invoked with the new Match payload
 */
export function useRealtime(
  userId: string | null | undefined,
  onMatch: (match: Match) => void,
): void {
  // Keep a stable ref so we don't re-subscribe on every render
  const onMatchRef = useRef(onMatch)
  onMatchRef.current = onMatch

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`matches:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'matches',
          // Filter rows where the current user is involved.
          // Supabase supports simple equality filters; for OR logic we
          // subscribe to both columns via two listeners on the same channel.
        },
        (payload) => {
          const match = payload.new as Match
          // Only fire if this user is the worker or employer in the match
          if (match.worker_id === userId || match.employer_id === userId) {
            onMatchRef.current(match)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
