import { spawn } from 'node:child_process'

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(command, ['vitest', 'run', 'src/renderer/__tests__/releaseCandidate.test.ts', '--disableConsoleIntercept'], {
  stdio: 'inherit',
  env: { ...process.env, BENCHMARK_PERFORMANCE: '1' },
})

child.on('exit', (code) => process.exit(code ?? 1))
