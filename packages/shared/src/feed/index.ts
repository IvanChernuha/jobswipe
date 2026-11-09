// Swipe deck rules shared by web and mobile (same behaviour as the web
// Feed.tsx): one card on top, one-step undo, bookmarks advance without a
// swipe, no double swipes. Pure functions over immutable state; the screens
// call the API and feed the results in.

export type SwipeKind = 'like' | 'pass' | 'super_like'
export type LastAction<C> = { card: C; kind: SwipeKind | 'bookmark' }

export interface DeckState<C> {
  cards: C[]
  /** The last card taken off the deck, for one-step undo. */
  last: LastAction<C> | null
  /** A swipe/bookmark/undo request is in flight. */
  busy: boolean
}

export const deck = {
  initial<C>(): DeckState<C> {
    return { cards: [], last: null, busy: false }
  },

  /** New cards from the server; replaces the deck and forgets undo. */
  loaded<C>(_s: DeckState<C>, cards: C[]): DeckState<C> {
    return { cards, last: null, busy: false }
  },

  top<C>(s: DeckState<C>): C | null {
    return s.cards[0] ?? null
  },

  remaining<C>(s: DeckState<C>): number {
    return s.cards.length
  },

  canAct<C>(s: DeckState<C>): boolean {
    return !s.busy && s.cards.length > 0
  },

  canUndo<C>(s: DeckState<C>): boolean {
    return !s.busy && s.last !== null
  },

  busy<C>(s: DeckState<C>, busy: boolean): DeckState<C> {
    return { ...s, busy }
  },

  swiped<C>(s: DeckState<C>, kind: SwipeKind): DeckState<C> {
    if (s.cards.length === 0) return s
    const [card, ...rest] = s.cards
    return { ...s, cards: rest, last: { card, kind } }
  },

  /** Saved for later: advances like a swipe, but the server sees no swipe. */
  bookmarked<C>(s: DeckState<C>): DeckState<C> {
    if (s.cards.length === 0) return s
    const [card, ...rest] = s.cards
    return { ...s, cards: rest, last: { card, kind: 'bookmark' } }
  },

  /** Puts the last card back on top (after the server confirmed the undo). */
  undone<C>(s: DeckState<C>): DeckState<C> {
    if (!s.last) return s
    return { ...s, cards: [s.last.card, ...s.cards], last: null }
  },
}

/** Fraction of the screen width a drag must cover to count as a swipe. */
export const SWIPE_DISTANCE = 0.3
/** Horizontal speed (px/s) that counts as a flick even on a short drag. */
export const SWIPE_VELOCITY = 800

/**
 * What a released drag means: like (right), pass (left) or snap back (null).
 * Runs on the phone's UI thread inside the gesture handler, so it must be a
 * worklet: calling a plain function from there crashes a release build.
 * (On the web the directive is just an unused string.)
 */
export function swipeDecision({ dx, vx, width }: { dx: number; vx: number; width: number }): 'like' | 'pass' | null {
  'worklet'
  const far = Math.abs(dx) > width * SWIPE_DISTANCE
  const flick = Math.abs(vx) > SWIPE_VELOCITY && Math.sign(vx) === Math.sign(dx)
  if (!far && !flick) return null
  return dx > 0 ? 'like' : 'pass'
}

/**
 * Where a card flies to when a button is pressed (and where it comes back
 * from on undo): like right, pass left, super like up, bookmark down. Far
 * enough to be fully off screen. A worklet, like swipeDecision.
 */
export function flingOffset(
  kind: SwipeKind | 'bookmark',
  { width, height }: { width: number; height: number },
): { x: number; y: number } {
  'worklet'
  switch (kind) {
    case 'like': return { x: width * 1.5, y: 0 }
    case 'pass': return { x: -width * 1.5, y: 0 }
    case 'super_like': return { x: 0, y: -height * 1.5 }
    case 'bookmark': return { x: 0, y: height * 1.5 }
  }
}
