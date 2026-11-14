// Sign release builds with our own key when the build provides one.
//
// scripts/mobile/build-android.sh passes the key through Gradle properties
// (JOBSWIPE_UPLOAD_STORE_FILE/_STORE_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD) when
// it finds the key on this machine; without them, release builds keep the
// template's debug key. The key never lives in the repository.
const { withAppBuildGradle } = require('expo/config-plugins')

const PROP = 'JOBSWIPE_UPLOAD_STORE_FILE'

const RELEASE_CONFIG = `
        release {
            if (findProperty('${PROP}')) {
                storeFile file(findProperty('${PROP}'))
                storePassword findProperty('JOBSWIPE_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('JOBSWIPE_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('JOBSWIPE_UPLOAD_KEY_PASSWORD')
            }
        }`

/** The edit itself (pure, for tests): add the release key, and use it for release builds. */
function addReleaseSigning(gradle) {
  if (gradle.includes(`findProperty('${PROP}')`)) return gradle
  const debugConfig = /(signingConfigs \{\s+debug \{[^}]*\})/
  const releaseUsesDebug = /(release \{[^}]*?)signingConfig signingConfigs\.debug/
  if (!debugConfig.test(gradle) || !releaseUsesDebug.test(gradle)) {
    throw new Error('withReleaseSigning: build.gradle signing setup not found (Expo template changed?)')
  }
  return gradle
    .replace(debugConfig, `$1${RELEASE_CONFIG}`)
    .replace(releaseUsesDebug, `$1signingConfig findProperty('${PROP}') ? signingConfigs.release : signingConfigs.debug`)
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addReleaseSigning(cfg.modResults.contents)
    return cfg
  })

module.exports = withReleaseSigning
module.exports.addReleaseSigning = addReleaseSigning
