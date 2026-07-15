import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const release = join(process.cwd(), 'release')
const directories = existsSync(release) ? readdirSync(release) : []
let executable

if (process.platform === 'darwin') {
  const appDirectory = directories.find((name) => name.startsWith('mac-'))
  executable = appDirectory && join(release, appDirectory, 'Excel Block Parser.app', 'Contents', 'MacOS', 'Excel Block Parser')
} else if (process.platform === 'win32') {
  executable = join(release, 'win-unpacked', 'Excel Block Parser.exe')
} else {
  executable = join(release, 'linux-unpacked', 'excel-block-parser')
}

if (!executable || !existsSync(executable)) {
  console.error(`Packaged executable was not found: ${executable ?? release}`)
  process.exit(1)
}

const result = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.electron.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_E2E_EXECUTABLE: executable },
})
process.exit(result.status ?? 1)
