import { SetColHiddenMutation, SetColVisibleMutation, SetRowHiddenMutation, SetRowVisibleMutation } from '@univerjs/sheets'

export function applyWorksheetVisibility(
  api: { syncExecuteCommand: (id: string, params: object) => unknown },
  unitId: string,
  sheet: { getSheet: () => { getSheetId: () => string; getRowCount: () => number; getColumnCount: () => number } },
  axis: 'row' | 'column', start: number, count: number, visible: boolean,
): void {
  if (count <= 0) return
  const raw = sheet.getSheet()
  const command = axis === 'row'
    ? visible ? SetRowVisibleMutation : SetRowHiddenMutation
    : visible ? SetColVisibleMutation : SetColHiddenMutation
  const range = axis === 'row'
    ? { startRow: start, endRow: start + count - 1, startColumn: 0, endColumn: raw.getColumnCount() - 1 }
    : { startColumn: start, endColumn: start + count - 1, startRow: 0, endRow: raw.getRowCount() - 1 }
  // Facade visibility commands also update selections. View hydration must not.
  if (!api.syncExecuteCommand(command.id, { unitId, subUnitId: raw.getSheetId(), ranges: [range] })) {
    throw new Error('Unable to apply worksheet visibility')
  }
}
