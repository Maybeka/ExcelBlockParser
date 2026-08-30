import ExcelJS from 'exceljs'
import { HorizontalAlign, WrapStrategy } from '@univerjs/core'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'

describe('XLSX workbook conversion', () => {
  it('preserves themed fills and multiline cell text for Univer', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    const cell = sheet.getCell('A1')
    cell.value = 'first line\nsecond line'
    cell.alignment = { horizontal: 'centerContinuous', wrapText: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { theme: 4, tint: 0.4 } as unknown as ExcelJS.Color,
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'themed.xlsx')
    const data = converted.workbookData.sheets.Data!.cellData![0]![0]!
    const style = converted.workbookData.styles![data.s as string]!

    expect(style.bg?.rgb).toMatch(/^#[0-9a-f]{6}$/i)
    expect(style.bg?.rgb).not.toBe('#FFFFFF')
    expect(style.tb).toBe(WrapStrategy.WRAP)
    expect(style.ht).toBe(HorizontalAlign.CENTER)
    expect(data.v).toBe('first line\rsecond line')
    expect((data.p as { body: { dataStream: string; paragraphs: Array<{ startIndex: number }>; sectionBreaks: Array<{ startIndex: number }> } }).body).toEqual({
      dataStream: 'first line\rsecond line\r\n',
      paragraphs: [{ startIndex: 10 }, { startIndex: 22 }],
      sectionBreaks: [{ startIndex: 23 }],
      textRuns: expect.any(Array),
    })
  })
})
