import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

export default defineConfig({
  plugins: [react()],
  root: resolve('src/renderer'),
  base: './',
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
  },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
    },
  },
})
