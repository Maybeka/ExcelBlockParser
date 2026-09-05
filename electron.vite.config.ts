import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; dependencies: Record<string, string> }
const packageLock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string }> }
const goMod = readFileSync(new URL('./go.mod', import.meta.url), 'utf8')
const appVersion = packageJson.version
const electronVersion = packageLock.packages['node_modules/electron']?.version ?? 'unknown'
const univerVersion = packageJson.dependencies['@univerjs/core'] ?? 'unknown'
const wailsVersion = goMod.match(/github\.com\/wailsapp\/wails\/v2\s+v([^\s]+)/)?.[1] ?? 'unknown'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.ELECTRON_VERSION': JSON.stringify(electronVersion),
      'import.meta.env.UNIVER_VERSION': JSON.stringify(univerVersion),
      'import.meta.env.WAILS_VERSION': JSON.stringify(wailsVersion),
    },
    // Univer is locally patched after installation. Its optimized dependency
    // bundle otherwise outlives the patched source during `npm run dev`.
    optimizeDeps: {
      force: true,
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
      },
    },
    plugins: [react()],
  },
})
