import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { releaseVersionForPackage } from './release-version.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const windows = process.platform === 'win32'
const python = process.env.PYWEBVIEW_PYTHON || resolve(root, '.venv-pywebview', windows ? 'Scripts/python.exe' : 'bin/python')
if (!existsSync(python)) {
  console.error('Create .venv-pywebview and install desktop_pywebview/requirements.txt first. See docs/PYWEBVIEW.md.')
  process.exit(1)
}

function run(command, args, extraEnv = {}) {
  const child = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: windows && command === 'npm', env: { ...process.env, ...extraEnv } })
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status ?? 1)
}

const mode = process.argv[2] || 'dev'
if (mode === 'package') {
  releaseVersionForPackage(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
    process.env.GITHUB_REF_TYPE, process.env.GITHUB_REF_NAME)
}
if (mode === 'test') {
  run(process.execPath, ['--test', 'scripts/patch-univer-formula-buffer.test.mjs'])
  run(python, ['-m', 'desktop_pywebview.build_helper'])
  run(python, ['-m', 'unittest', 'discover', '-s', 'desktop_pywebview', '-t', '.', '-v'])
} else if (mode === 'dev' || mode === 'smoke' || mode === 'suite' || mode === 'project' || mode === 'browser' || mode === 'outline' || mode === 'python' || mode === 'window' || mode === 'drawing' || mode === 'preferences' || mode === 'recovery' || mode === 'package') {
  run('npm', ['run', 'build:vite'])
  run(python, ['-m', 'desktop_pywebview.build_helper'])
  if (mode === 'browser' || mode === 'outline' || mode === 'package') run(process.execPath, ['scripts/prepare-pywebview-browser-fixtures.mjs'])
  if (mode === 'drawing' || mode === 'package') run(process.execPath, ['scripts/prepare-pywebview-drawing-fixtures.mjs'])
  if (mode === 'package') {
    run(python, ['-m', 'PyInstaller', '--noconfirm', '--distpath', 'release-pywebview', '--workpath', '.tmp/pywebview-build', 'scripts/pywebview.spec'], {
      PYINSTALLER_CONFIG_DIR: process.env.PYINSTALLER_CONFIG_DIR || resolve(root, '.tmp/pyinstaller-cache'),
    })
    run(python, ['-m', 'desktop_pywebview.build_manifest'])
  } else if (mode === 'recovery') {
    run(python, ['-m', 'desktop_pywebview.recovery_suite'])
  } else if (mode === 'preferences') {
    run(python, ['-m', 'desktop_pywebview', '--native-preferences-suite'])
  } else if (mode === 'project') {
    run(python, ['-m', 'desktop_pywebview', '--native-project-suite'])
  } else if (mode === 'browser') {
    run(python, ['-m', 'desktop_pywebview', '--native-browser-suite'])
  } else if (mode === 'outline') {
    run(python, ['-m', 'desktop_pywebview', '--native-outline-suite'])
  } else if (mode === 'python') {
    run(python, ['-m', 'desktop_pywebview', '--native-python-suite'])
  } else if (mode === 'window') {
    run(python, ['-m', 'desktop_pywebview', '--native-window-suite'])
  } else if (mode === 'drawing') {
    run(python, ['-m', 'desktop_pywebview', '--native-drawing-suite'])
  } else {
    run(python, ['-m', 'desktop_pywebview', mode === 'suite' ? '--native-suite' : mode === 'smoke' ? '--smoke-test' : '--debug'])
  }
} else {
  console.error(`Unknown pywebview command: ${mode}`)
  process.exit(1)
}
