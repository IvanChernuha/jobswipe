// The repeat timer behind chat (and later other live screens): runs every
// interval, always the latest callback, and stops when the screen closes.
import { act, renderHook } from '@testing-library/react-native'
import { usePolling } from '../src/lib/usePolling'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it('runs the callback every interval', async () => {
  const fn = jest.fn()
  await renderHook(() => usePolling(fn, 3000))
  expect(fn).not.toHaveBeenCalled()
  await act(async () => { jest.advanceTimersByTime(3000) })
  expect(fn).toHaveBeenCalledTimes(1)
  await act(async () => { jest.advanceTimersByTime(6000) })
  expect(fn).toHaveBeenCalledTimes(3)
})

it('stops when the screen closes', async () => {
  const fn = jest.fn()
  const { unmount } = await renderHook(() => usePolling(fn, 3000))
  await unmount()
  await act(async () => { jest.advanceTimersByTime(9000) })
  expect(fn).not.toHaveBeenCalled()
})

it('does nothing while switched off', async () => {
  const fn = jest.fn()
  await renderHook(() => usePolling(fn, 3000, false))
  await act(async () => { jest.advanceTimersByTime(9000) })
  expect(fn).not.toHaveBeenCalled()
})

it('uses the latest callback without restarting the timer', async () => {
  const first = jest.fn()
  const second = jest.fn()
  const { rerender } = await renderHook(({ fn }: { fn: () => void }) => usePolling(fn, 3000), { initialProps: { fn: first } })
  await act(async () => { jest.advanceTimersByTime(2000) })
  await rerender({ fn: second })
  await act(async () => { jest.advanceTimersByTime(1000) })
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
})
