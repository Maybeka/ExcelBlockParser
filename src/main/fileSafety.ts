export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024
export const MAX_PROJECT_BYTES = 25 * 1024 * 1024
export const FILE_READ_TIMEOUT_MS = 30_000

export function isSupportedWorkbookPath(filePath: string): boolean {
  return /\.(xlsx|xls)$/i.test(filePath)
}

export function sanitizeJsonFileName(value: unknown, fallback = 'project.json'): string {
  if (typeof value !== 'string') return fallback
  const name = value.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? ''
  if (!name) return fallback
  return name.endsWith('.json') ? name : `${name}.json`
}

export function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = FILE_READ_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) })
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}
