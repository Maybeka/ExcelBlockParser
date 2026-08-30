import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'test:main']],
  ['npm', ['run', 'test:release']],
  ['npm', ['run', 'test:unit']],
  ['npm', ['test']],
  ['npm', ['run', 'test:native']],
]

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
