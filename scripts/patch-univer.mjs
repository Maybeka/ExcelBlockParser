import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { patchInstalledFormulaBuffers } from './patch-univer-formula-buffer.mjs'

execFileSync(process.execPath, [fileURLToPath(new URL('./patch-univer-outline.mjs', import.meta.url))], { stdio: 'inherit' })
await patchInstalledFormulaBuffers()
