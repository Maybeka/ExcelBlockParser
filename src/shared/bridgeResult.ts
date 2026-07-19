export type BridgeErrorCode = 'validation' | 'access' | 'not-found' | 'too-large' | 'timeout' | 'internal'

export type BridgeResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled' }
  | { status: 'error'; error: { code: BridgeErrorCode; message: string } }

export function bridgeOk<T>(value: T): BridgeResult<T> {
  return { status: 'ok', value }
}

export function bridgeCancelled<T>(): BridgeResult<T> {
  return { status: 'cancelled' }
}

export function bridgeError<T>(error: unknown): BridgeResult<T> {
  const message = error instanceof Error ? error.message : String(error || 'Unknown desktop operation failure.')
  const lower = message.toLowerCase()
  const code: BridgeErrorCode = lower.includes('too large') || lower.includes('exceeds the')
    ? 'too-large'
    : lower.includes('timed out') || lower.includes('timeout')
      ? 'timeout'
      : lower.includes('not found') || lower.includes('unavailable') || lower.includes('enoent')
        ? 'not-found'
        : lower.includes('selected through') || lower.includes('before reading') || lower.includes('access')
          ? 'access'
          : lower.includes('invalid') || lower.includes('must be json') || lower.includes('select an')
            ? 'validation'
            : 'internal'
  return { status: 'error', error: { code, message } }
}
