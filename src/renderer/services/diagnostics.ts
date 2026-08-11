import type { CellRange, ParseDiagnostic } from '../types'

export interface DiagnosticFocusTarget {
  workbookId: string | null
  sheetName: string | null
  range: CellRange | null
  featureId?: string
  itemId?: string
}

export function orderDiagnostics(diagnostics: ParseDiagnostic[]): ParseDiagnostic[] {
  const severity = { error: 0, warning: 1 } as const
  return [...diagnostics].sort((a, b) => severity[a.severity] - severity[b.severity]
    || (a.workbookId ?? '').localeCompare(b.workbookId ?? '')
    || a.code.localeCompare(b.code)
    || (a.blockId ?? a.regionId ?? '').localeCompare(b.blockId ?? b.regionId ?? ''))
}
