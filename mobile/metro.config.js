// Metro (the app's bundler) also needs to see packages/shared, which lives
// outside this folder and is imported as @jobswipe/shared.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const sharedRoot = path.resolve(__dirname, '../packages/shared')

config.watchFolders = [...(config.watchFolders ?? []), sharedRoot]
// Shared files have no node_modules next to them; resolve their imports
// (e.g. Babel helpers) from the app's.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@jobswipe/shared': path.join(sharedRoot, 'src'),
}

module.exports = config
