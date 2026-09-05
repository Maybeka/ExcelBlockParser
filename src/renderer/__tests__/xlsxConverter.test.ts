import ExcelJS from 'exceljs'
import { HorizontalAlign, WrapStrategy } from '@univerjs/core'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData, deriveOutlineGroups } from '../services/xlsx-converter'

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

  it('captures frozen panes and the collapsed Excel outline state', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }]
    sheet.getCell('B2').value = 'outlined row and column'
    sheet.getCell('C3').value = 'manually hidden row and column'
    sheet.getRow(2).outlineLevel = 1
    sheet.getRow(2).hidden = true
    sheet.getRow(3).hidden = true
    sheet.getColumn(2).outlineLevel = 1
    sheet.getColumn(2).hidden = true
    sheet.getColumn(3).hidden = true

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'outlined.xlsx')
    const data = converted.workbookData.sheets.Data!

    expect(converted.sheetDisplaySettings.Data).toEqual({
      freeze: { startRow: 1, startColumn: 2, xSplit: 2, ySplit: 1 },
      lastRow: 2,
      lastColumn: 2,
      sourceHiddenRows: [1, 2],
      sourceHiddenColumns: [1, 2],
      outlinedHiddenRows: [1],
      outlinedHiddenColumns: [1],
      outlineGroups: [
        { id: 'row:1:1:1', axis: 'row', start: 1, end: 1, level: 1, initialCollapsed: true },
        { id: 'column:1:1:1', axis: 'column', start: 1, end: 1, level: 1, initialCollapsed: true },
      ],
    })
    expect(data.rowData![1]).toMatchObject({ hd: 1 })
    expect(data.rowData![2]).toMatchObject({ hd: 1 })
    expect(data.columnData![1]).toMatchObject({ hd: 1 })
    expect(data.columnData![2]).toMatchObject({ hd: 1 })
  })

  it('derives independently controllable nested outline groups', () => {
    expect(deriveOutlineGroups('row', [0, 1, 2, 2, 1, 0], [2, 3])).toEqual([
      { id: 'row:1:1:4', axis: 'row', start: 1, end: 4, level: 1, initialCollapsed: false },
      { id: 'row:2:2:3', axis: 'row', start: 2, end: 3, level: 2, initialCollapsed: true },
    ])
  })

  it('converts formulas and object cell values to displayable Univer data', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.getCell('A1').value = 2
    sheet.getCell('A2').value = { formula: 'A1*2', result: 4 }
    sheet.getCell('A3').value = { text: 'Project home', hyperlink: 'https://example.test' }
    sheet.getCell('A4').value = { error: '#DIV/0!' } as ExcelJS.CellValue

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'values.xlsx')
    const cells = converted.workbookData.sheets.Data!.cellData!

    expect(cells[1]![0]).toMatchObject({ f: '=A1*2', v: 4 })
    expect(cells[2]![0]).toMatchObject({ v: 'Project home' })
    expect(cells[3]![0]).toMatchObject({ v: '#DIV/0!' })
    expect(Object.values(cells).flatMap(row => Object.values(row)).some(cell => cell.v === '[object Object]')).toBe(false)
  })

  it('extracts embedded worksheet images with their anchored positions', async () => {
    const workbook = new ExcelJS.Workbook()
    const imageId = workbook.addImage({
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2L8kAAAAASUVORK5CYII=',
      extension: 'png',
    })
    const sheet = workbook.addWorksheet('Data')
    sheet.addImage(imageId, { tl: { col: 1, row: 2 }, ext: { width: 120, height: 60 } })

    const buffer = await workbook.xlsx.writeBuffer()
    const converted = await convertXlsxToWorkbookData(buffer as ArrayBuffer, 'images.xlsx')

    expect(converted.images).toEqual([expect.objectContaining({
      sheetName: 'Data',
      source: expect.stringMatching(/^data:image\/png;base64,/),
      from: { column: 1, columnOffset: 0, row: 2, rowOffset: 0 },
      width: 120,
      height: 60,
    })])
  })
})
