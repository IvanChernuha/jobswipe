// Release builds are signed with our own key when the build provides one
// (scripts/mobile/build-android.sh), else with the template's debug key.
// The plugin edits the generated android/app/build.gradle; this checks the
// edit against the real Expo template text.
import { addReleaseSigning } from '../plugins/withReleaseSigning'

const TEMPLATE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
        }
    }`

it('adds a release key read from build properties', () => {
  const out = addReleaseSigning(TEMPLATE)
  expect(out).toMatch(/release \{\s+if \(findProperty\('JOBSWIPE_UPLOAD_STORE_FILE'\)\) \{/)
  expect(out).toContain("storeFile file(findProperty('JOBSWIPE_UPLOAD_STORE_FILE'))")
  expect(out).toContain("storePassword findProperty('JOBSWIPE_UPLOAD_STORE_PASSWORD')")
  expect(out).toContain("keyAlias findProperty('JOBSWIPE_UPLOAD_KEY_ALIAS')")
  expect(out).toContain("keyPassword findProperty('JOBSWIPE_UPLOAD_KEY_PASSWORD')")
})

it('release builds use it when given, the debug key otherwise; debug builds are untouched', () => {
  const out = addReleaseSigning(TEMPLATE)
  expect(out).toContain(
    "signingConfig findProperty('JOBSWIPE_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  )
  const debugBlock = out.slice(out.indexOf('buildTypes {'), out.indexOf('release {', out.indexOf('buildTypes {')))
  expect(debugBlock).toContain('signingConfig signingConfigs.debug')
})

it('running twice changes nothing more', () => {
  const once = addReleaseSigning(TEMPLATE)
  expect(addReleaseSigning(once)).toBe(once)
})

it('fails loudly if the template changes shape', () => {
  expect(() => addReleaseSigning('android { }')).toThrow(/signing/)
})
