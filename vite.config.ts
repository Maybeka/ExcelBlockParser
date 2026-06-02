import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: resolve('src/renderer'),
  base: './',
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
