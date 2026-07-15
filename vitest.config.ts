import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.{test,spec,integration.test}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
})
