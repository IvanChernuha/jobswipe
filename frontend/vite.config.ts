import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export const sharedAlias = {
  // packages/shared: code shared with the mobile app (no dependencies of its own).
  '@jobswipe/shared': fileURLToPath(new URL('../packages/shared/src', import.meta.url)),
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias: sharedAlias },
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
})
