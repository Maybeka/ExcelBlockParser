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
 * Restores the selection for the sheet currently being presented. Univer's
 * select-range command changes the active sheet even when a target sheet is
 * supplied, so applying it to every sheet leaves the workbook on the final
 * sheet and corrupts the visible selection state.
 */
export function restoreWorkbookSelections(
  api: WorkbookSelectionCommandApi,
  workbook: SelectableWorkbook,
  savedSelections: Record<string, string>,
  activeSheetName: string | null,
): void {
  const sheet = workbook.getSheets().find(candidate => candidate.getSheetName() === activeSheetName)
  if (!sheet) return
  const a1Notation = savedSelections[sheet.getSheetName()] ?? 'A1'
  try {
    api.syncExecuteCommand('sheet.command.select-range', {
      unitId: workbook.getId(),
      // Univer 0.10 resolves the target through subUnitId but persists the
      // selection through its legacy subUnit field. Both are required.
      subUnitId: sheet.getSheetId(),
      subUnit: sheet.getSheetId(),
      range: sheet.getRange(a1Notation).getRange(),
    })
  } catch {
    // A malformed saved address must not block the workbook from opening.
    if (a1Notation === 'A1') return
    try {
      api.syncExecuteCommand('sheet.command.select-range', {
        unitId: workbook.getId(),
        subUnitId: sheet.getSheetId(),
        subUnit: sheet.getSheetId(),
        range: sheet.getRange('A1').getRange(),
      })
    } catch { /* sheet skeleton may still be initializing */ }
  }
}
