export interface WorkbookSelectionRange {
  getRange(): unknown
}

export interface SelectableWorksheet {
  getSheetId(): string
  getSheetName(): string
  getRange(a1Notation: string): WorkbookSelectionRange
}

export interface SelectableWorkbook {
  getId(): string
  getSheets(): SelectableWorksheet[]
}

export interface WorkbookSelectionCommandApi {
  syncExecuteCommand(command: string, params: Record<string, unknown>): unknown
}

/**
 * Seeds Univer's per-sheet selection model without changing the active sheet.
 * Excel's saved active cell is used when available, otherwise the normal A1
 * fallback is applied only to that sheet.
 */
export function restoreWorkbookSelections(
  api: WorkbookSelectionCommandApi,
  workbook: SelectableWorkbook,
  savedSelections: Record<string, string>,
): void {
  for (const sheet of workbook.getSheets()) {
    const a1Notation = savedSelections[sheet.getSheetName()] ?? 'A1'
    try {
      api.syncExecuteCommand('sheet.command.select-range', {
        unitId: workbook.getId(),
        subUnitId: sheet.getSheetId(),
        range: sheet.getRange(a1Notation).getRange(),
      })
    } catch {
      // A malformed saved address must not block the workbook from opening.
      if (a1Notation === 'A1') continue
      try {
        api.syncExecuteCommand('sheet.command.select-range', {
          unitId: workbook.getId(),
          subUnitId: sheet.getSheetId(),
          range: sheet.getRange('A1').getRange(),
        })
      } catch { /* sheet skeleton may still be initializing */ }
    }
  }
}
