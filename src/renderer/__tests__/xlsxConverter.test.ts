import ExcelJS from 'exceljs'
import { WrapStrategy } from '@univerjs/core'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'

describe('XLSX workbook conversion', () => {
  it('preserves themed fills and multiline cell text for Univer', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    const cell = sheet.getCell('A1')
    cell.value = 'first line\nsecond line'
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 4, tint: 0.4 } }

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'themed.xlsx')
    const data = converted.workbookData.sheets.Data!.cellData![0]![0]!
    const style = converted.workbookData.styles![data.s as string]!

    expect(style.bg?.rgb).toMatch(/^#[0-9a-f]{6}$/i)
    expect(style.bg?.rgb).not.toBe('#FFFFFF')
    expect(style.tb).toBe(WrapStrategy.WRAP)
    expect(data.v).toBe('first line\r\nsecond line')
    expect((data.p as { body: { dataStream: string } }).body.dataStream).toBe('first line\r\nsecond line\r\n')
  })
})
