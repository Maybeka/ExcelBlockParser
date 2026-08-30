import { spawnSync } from 'node:child_process'

const repository = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
if (repository.status === 0) {
  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
}
