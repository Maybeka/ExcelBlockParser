import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; dependencies: Record<string, string> }
const packageLock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string }> }
const goMod = readFileSync(new URL('./go.mod', import.meta.url), 'utf8')
const appVersion = packageJson.version
const electronVersion = packageLock.packages['node_modules/electron']?.version ?? 'unknown'
const univerVersion = packageJson.dependencies['@univerjs/core'] ?? 'unknown'
const wailsVersion = goMod.match(/github\.com\/wailsapp\/wails\/v2\s+v([^\s]+)/)?.[1] ?? 'unknown'

export default defineConfig({
  plugins: [react()],
  root: resolve('src/renderer'),
  base: './',
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.ELECTRON_VERSION': JSON.stringify(electronVersion),
    'import.meta.env.UNIVER_VERSION': JSON.stringify(univerVersion),
    'import.meta.env.WAILS_VERSION': JSON.stringify(wailsVersion),
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
