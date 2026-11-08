// The swipe deck's rules, shared by web and mobile (Mobile P4; same behaviour
// as the web Feed.tsx): one card on top, one-step undo, bookmarks advance
// without a swipe, no double swipes, and the drag gesture's decision.
import { describe, expect, it } from 'vitest'
import { deck, swipeDecision } from '..'

const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }

describe('deck', () => {
  it('starts empty and shows the first loaded card on top', () => {
    expect(deck.top(deck.initial())).toBeNull()
    const s = deck.loaded(deck.initial(), [a, b, c])
    expect(deck.top(s)).toBe(a)
    expect(deck.remaining(s)).toBe(3)
  })

  it('a swipe removes the top card and remembers it for undo', () => {
    const s = deck.swiped(deck.loaded(deck.initial(), [a, b]), 'like')
    expect(deck.top(s)).toBe(b)
    expect(s.last).toEqual({ card: a, kind: 'like' })
    expect(deck.canUndo(s)).toBe(true)
  })

  it('undo puts the last card back on top, once', () => {
    let s = deck.swiped(deck.loaded(deck.initial(), [a, b]), 'pass')
    s = deck.undone(s)
    expect(deck.top(s)).toBe(a)
    expect(deck.canUndo(s)).toBe(false)
    expect(deck.undone(s)).toBe(s) // nothing more to undo
  })

  it('only the most recent swipe can be undone', () => {
    let s = deck.loaded(deck.initial(), [a, b, c])
    s = deck.swiped(deck.swiped(s, 'like'), 'pass')
    expect(s.last).toEqual({ card: b, kind: 'pass' })
    s = deck.undone(s)
    expect(deck.top(s)).toBe(b)
    expect(deck.remaining(s)).toBe(2)
  })

  it('a bookmark advances like a swipe but is remembered as a bookmark', () => {
    const s = deck.bookmarked(deck.loaded(deck.initial(), [a, b]))
    expect(deck.top(s)).toBe(b)
    expect(s.last).toEqual({ card: a, kind: 'bookmark' })
  })

  it('super likes are remembered as super likes', () => {
    const s = deck.swiped(deck.loaded(deck.initial(), [a]), 'super_like')
    expect(s.last?.kind).toBe('super_like')
    expect(deck.top(s)).toBeNull()
  })

  it('nothing happens when swiping an empty deck', () => {
    const s = deck.initial()
    expect(deck.swiped(s, 'like')).toBe(s)
    expect(deck.bookmarked(s)).toBe(s)
  })

  it('blocks a second swipe while one is in flight', () => {
    let s = deck.loaded(deck.initial(), [a, b])
    expect(deck.canAct(s)).toBe(true)
    s = deck.busy(s, true)
    expect(deck.canAct(s)).toBe(false)
    expect(deck.canAct(deck.busy(s, false))).toBe(true)
  })

  it('reloading replaces the cards and forgets undo', () => {
    let s = deck.swiped(deck.loaded(deck.initial(), [a, b]), 'like')
    s = deck.loaded(s, [c])
    expect(deck.top(s)).toBe(c)
    expect(deck.canUndo(s)).toBe(false)
  })
})

describe('swipeDecision (drag gesture)', () => {
  const width = 400

  it('a long drag right is a like, left is a pass', () => {
    expect(swipeDecision({ dx: 150, vx: 0, width })).toBe('like')
    expect(swipeDecision({ dx: -150, vx: 0, width })).toBe('pass')
  })

  it('a short slow drag snaps back', () => {
    expect(swipeDecision({ dx: 60, vx: 100, width })).toBeNull()
    expect(swipeDecision({ dx: -60, vx: -100, width })).toBeNull()
  })

  it('a quick flick counts even when short', () => {
    expect(swipeDecision({ dx: 40, vx: 1200, width })).toBe('like')
    expect(swipeDecision({ dx: -40, vx: -1200, width })).toBe('pass')
  })

  it('a flick against the drag direction does not count', () => {
    expect(swipeDecision({ dx: 40, vx: -1200, width })).toBeNull()
  })

  it('the distance threshold scales with the screen width', () => {
    expect(swipeDecision({ dx: 110, vx: 0, width: 300 })).toBe('like') // 110 > 30% of 300
    expect(swipeDecision({ dx: 110, vx: 0, width: 500 })).toBeNull() // 110 < 30% of 500
  })
})
