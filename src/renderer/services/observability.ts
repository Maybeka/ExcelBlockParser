import type { BridgeResult } from '../../shared/bridgeResult'
import type { ParseResult } from '../types'

export interface LocalDiagnostic {
  area: 'bridge' | 'parse'
  operation: string
  code: string
  severity: 'warning' | 'error'
  blockId?: string
  regionId?: string
}

function record(diagnostic: LocalDiagnostic): void {
  console.warn('[excel-block-parser diagnostic]', JSON.stringify(diagnostic))
}

export function recordBridgeFailure(operation: string, result: BridgeResult<unknown>): void {
  if (result.status !== 'error') return
  record({ area: 'bridge', operation, code: result.error.code, severity: 'error' })
}

export function recordParseFailure(operation: string, result: ParseResult): void {
  for (const diagnostic of result.diagnostics ?? []) {
    record({
      area: 'parse',
      operation,
      code: diagnostic.code,
      severity: diagnostic.severity,
      blockId: diagnostic.blockId,
      regionId: diagnostic.regionId,
    })
  }
}
