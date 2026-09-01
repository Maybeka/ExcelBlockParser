import { describe, expect, it } from 'vitest'
import { bridgeOk } from '../../shared/bridgeResult'
import type { BlockConfig, ProjectConfig } from '../types'
import { executeProject } from '../services/projectExecution'
import type { WorkbookReader, WorkbookSheet } from '../services/workbook'

function block(id: string, workbookId: string): BlockConfig {
  return { id, workbookId, label: 'block_1', activeSheet: 'Sheet1', range: { startRow: 0, startCol: 0, endRow: 1, endCol: 0, a1Notation: 'A1:A2' }, headerRows: [0], collapsed: false, selectionLocked: false, columns: [{ colIndex: 0, colLetter: 'A', suggestedKey: 'value', key: 'value', type: 'string', skip: false, valueMap: [] }], dataSnapshot: null }
}
function workbook(value: string): WorkbookReader {
  const sheet: WorkbookSheet = { name: 'Sheet1', getValues: () => [['value'], [value]], getValuesByA1: () => [['value'], [value]], getMergedRanges: () => [] }
  return { sheetNames: () => ['Sheet1'], getActiveSheet: () => sheet, getSheet: () => sheet }
}
const project: ProjectConfig = { id: 'p', name: 'P', workbooks: [{ id: 'a', name: 'a.xlsx', sheetNames: ['Sheet1'], activeSheetName: 'Sheet1' }, { id: 'b', name: 'b.xlsx', sheetNames: ['Sheet1'], activeSheetName: 'Sheet1' }], activeWorkbookId: 'a', blocks: [block('ba', 'a'), block('bb', 'b')], regions: [], activeBlockId: 'ba', activeRegionId: null, focusMode: 'always-editable' }

describe('project execution coordinator', () => {
  it('keeps duplicate labels isolated by workbook and prepares every preview', async () => {
    const result = await executeProject(project, { a: '/a', b: '/b' }, async path => bridgeOk(new TextEncoder().encode(path).buffer), async buffer => workbook(new TextDecoder().decode(buffer)))
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return
    expect(result.result.data.a).toEqual({ block_1: [{ value: '/a' }] })
    expect(result.result.data.b).toEqual({ block_1: [{ value: '/b' }] })
    expect(result.previews.size).toBe(2)
    expect(result.sourceFingerprints).toEqual({
      a: expect.stringMatching(/^2:/),
      b: expect.stringMatching(/^2:/),
    })
  })
  it('reports an unavailable reader through parse diagnostics', async () => {
    const result = await executeProject(project, { a: '/a' }, async () => bridgeOk(new ArrayBuffer(1)), async () => workbook('a'))
    expect(result.status).toBe('complete')
    if (result.status === 'complete') expect(result.result.diagnostics?.some(item => item.workbookId === 'b')).toBe(true)
  })
  it('discards stale runs before committing results', async () => {
    let current = true
    const result = await executeProject(project, { a: '/a' }, async () => { current = false; return bridgeOk(new ArrayBuffer(1)) }, async () => workbook('a'), () => current)
    expect(result).toEqual({ status: 'stale' })
  })
})
