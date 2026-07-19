import { createHash } from 'node:crypto'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const wails = process.env.WAILS_BIN || resolve(spawnSync('go', ['env', 'GOPATH'], { encoding: 'utf8' }).stdout.trim(), 'bin', 'wails.exe')
const executable = resolve(root, 'build', 'bin', 'excel-block-parser.exe')
const outputDir = resolve(root, 'release-wails')
const archiveName = `ExcelBlockParser-v${pkg.version}-windows-x64.zip`
const archive = resolve(outputDir, archiveName)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (process.platform !== 'win32') {
  console.error('Wails Windows packaging must run on Windows.')
  process.exit(1)
}

run(wails, ['build', '-platform', 'windows/amd64'])
await mkdir(outputDir, { recursive: true })
await rm(archive, { force: true })
run('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'param($source, $destination) Compress-Archive -LiteralPath $source -DestinationPath $destination -Force',
  executable,
  archive,
])

const hash = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(`${archive}.sha256`, `${hash}  ${archiveName}\n`)
console.log(`Created ${archive}`)
console.log(`SHA-256 ${hash}`)
