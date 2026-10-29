import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { sharedAlias } from './vite.config'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: sharedAlias },
  // Allow loading files from ../packages (outside this project's root).
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Shared package tests run here too (it has no dependencies of its own).
    include: ['src/**/*.test.{ts,tsx}', '../packages/shared/src/**/*.test.ts'],
  },
})
