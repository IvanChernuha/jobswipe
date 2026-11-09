// Code that runs on the phone's UI thread (inside gestures/animations) must be
// compiled as worklets, or a release build crashes the moment it runs. Jest
// can't run the UI thread, so check the compiled output instead, using the
// app's own Babel setup (the same step Metro runs for the real build).
// Regression: 0.3.0 crashed on releasing a dragged card (2026-11-08).
import path from 'path'
import { transformFileSync } from '@babel/core'

function compiled(file: string): string {
  const filename = path.resolve(__dirname, file)
  return transformFileSync(filename, {
    cwd: path.resolve(__dirname, '..'),
    filename,
    // babel-preset-expo is a dependency of the expo package, not a top-level one.
    presets: [require.resolve('babel-preset-expo', { paths: [require.resolve('expo')] })],
    babelrc: false,
    configFile: false,
  })!.code!
}

it('swipeDecision (shared, called while dragging) is compiled as a worklet', () => {
  const code = compiled('../../packages/shared/src/feed/index.ts')
  const fn = code.slice(code.indexOf('function swipeDecision'))
  expect(fn.slice(0, 2000)).toMatch(/__workletHash/)
})

it('flingOffset (shared, used by the button and undo animations) is compiled as a worklet', () => {
  const code = compiled('../../packages/shared/src/feed/index.ts')
  const fn = code.slice(code.indexOf('function flingOffset'))
  expect(fn.slice(0, 2000)).toMatch(/__workletHash/)
})
