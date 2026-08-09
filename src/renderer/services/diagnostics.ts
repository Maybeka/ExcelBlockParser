import type { CellRange, ParseDiagnostic, ProjectConfig } from '../types'

export interface DiagnosticFocusTarget {
  workbookId: string | null
  sheetName: string | null
  range: CellRange | null
  blockId?: string
  regionId?: string
}

export function diagnosticFocusTarget(project: ProjectConfig, diagnostic: ParseDiagnostic): DiagnosticFocusTarget | null {
  if (diagnostic.blockId) {
    const block = project.blocks.find(item => item.id === diagnostic.blockId)
    return block ? { workbookId: block.workbookId ?? null, sheetName: block.activeSheet, range: block.range, blockId: block.id } : null
  }
  if (diagnostic.regionId) {
    const region = project.regions.find(item => item.id === diagnostic.regionId)
    return region ? { workbookId: region.workbookId ?? null, sheetName: region.activeSheet, range: region.range, regionId: region.id } : null
  }
  return diagnostic.workbookId ? { workbookId: diagnostic.workbookId, sheetName: null, range: null } : null
}

export function orderDiagnostics(diagnostics: ParseDiagnostic[]): ParseDiagnostic[] {
  const severity = { error: 0, warning: 1 } as const
  return [...diagnostics].sort((a, b) => severity[a.severity] - severity[b.severity]
    || (a.workbookId ?? '').localeCompare(b.workbookId ?? '')
    || a.code.localeCompare(b.code)
    || (a.blockId ?? a.regionId ?? '').localeCompare(b.blockId ?? b.regionId ?? ''))
}
