import type { IWorkbookData, IWorksheetData, ICellData, IDocumentData } from '@univerjs/core'
import {
  BorderStyleTypes,
  BooleanNumber,
  CellValueType,
  HorizontalAlign,
  LocaleType,
  VerticalAlign,
  WrapStrategy,
} from '@univerjs/core'
import type { IStyleData } from '@univerjs/core'
import ExcelJS from 'exceljs'
import { DEFAULT_CELL_FONT, FORCE_DEFAULT_FONT } from '../config'

type CellMatrix = Record<number, Record<number, ICellData>>

export interface ConversionResult {
  workbookData: IWorkbookData
  fonts: string[]
}

export async function convertXlsxToWorkbookData(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): Promise<ConversionResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer)

  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []
  const styleMap = new Map<string, string>()
  const styles: Record<string, IStyleData> = {}
  let styleCounter = 0

  function registerStyle(style: IStyleData): string {
    const key = stableStringify(style)
    const existing = styleMap.get(key)
    if (existing) return existing
    const id = `s${++styleCounter}`
    styleMap.set(key, id)
    styles[id] = style
    return id
  }

  workbook.eachSheet((worksheet, sheetIndex) => {
    const sheetId = worksheet.name || `Sheet${sheetIndex}`
    sheetOrder.push(sheetId)

    const cellData: CellMatrix = {}
    let maxRow = 0
    let maxCol = 0

    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const rowIdx = rowNumber - 1
      if (rowIdx > maxRow) maxRow = rowIdx
      const rowData: Record<number, ICellData> = {}

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colIdx = colNumber - 1
        if (colIdx > maxCol) maxCol = colIdx

        const univerCell: ICellData = {}

        if (cell.value != null) {
          if (cell.value instanceof Date) {
            univerCell.v = dateToExcelSerial(cell.value)
          } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
            const richTextValue = cell.value as { richText: Array<{ text: string; font?: Partial<ExcelJS.Font> }> }
            univerCell.v = richTextValue.richText.map(s => s.text).join('')
            univerCell.p = convertRichTextToDocumentData(
              richTextValue.richText,
              cell.style?.font as Partial<ExcelJS.Font> | undefined,
            )
          } else if (typeof cell.value === 'object') {
            univerCell.v = cell.text
          } else {
            univerCell.v = cell.value as string | number | boolean
          }
        }

        if (cell.type === ExcelJS.ValueType.Formula && cell.result != null) {
          univerCell.v = cell.result as string | number | boolean
        }

        if (cell.type) {
          univerCell.t = mapCellType(cell.type, cell.value)
        }

        const cellStyle = buildCellStyle(cell)
        if (cellStyle) {
          univerCell.s = cellStyle
        }

        if (Object.keys(univerCell).length === 0) return
        rowData[colIdx] = univerCell
      })

      if (Object.keys(rowData).length > 0) {
        cellData[rowIdx] = rowData
      }
    })

    deduplicateStyles(cellData, registerStyle)

    const mergeData: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }> = []
    if (worksheet.model?.merges) {
      for (const mergeRange of worksheet.model.merges as string[]) {
        const parts = mergeRange.split(':')
        if (parts.length !== 2) continue
        const start = excelAddressToRC(parts[0])
        const end = excelAddressToRC(parts[1])
        if (!start || !end) continue
        mergeData.push({
          startRow: start.row,
          startColumn: start.col,
          endRow: end.row,
          endColumn: end.col,
        })
      }
    }

    const columnData: Record<number, { w: number }> = {}
    for (let c = 0; c <= maxCol; c++) {
      const col = worksheet.getColumn(c + 1)
      if (col?.width != null) {
        columnData[c] = { w: col.width * 8 }
      }
    }

    const rowHeights: Record<number, { h: number }> = {}
    for (let r = 0; r <= maxRow; r++) {
      const row = worksheet.getRow(r + 1)
      if (row?.height != null) {
        rowHeights[r] = { h: row.height * 1.333 }
      }
    }

    sheets[sheetId] = {
      id: sheetId,
      name: worksheet.name || sheetId,
      rowCount: maxRow + 50,
      columnCount: maxCol + 50,
      cellData,
      ...(mergeData.length > 0 ? { mergeData } : {}),
      ...(Object.keys(columnData).length > 0 ? { columnData } : {}),
      ...(Object.keys(rowHeights).length > 0 ? { rowData: rowHeights } : {}),
    }
  })

  const fontSet = new Set<string>()
  for (const style of Object.values(styles)) {
    if (style.ff) fontSet.add(style.ff)
  }

  return {
    workbookData: {
      id: `workbook-${Date.now()}`,
      name: fileName,
      appVersion: '0.22.0',
      locale: LocaleType.EN_US,
      styles,
      sheetOrder,
      sheets,
    },
    fonts: [...fontSet],
  }
}

function dateToExcelSerial(date: Date): number {
  const msPerDay = 86400000
  const excelEpoch = Date.UTC(1899, 11, 30)
  return (date.getTime() - excelEpoch) / msPerDay
}

function convertRichTextToDocumentData(
  richText: Array<{ text: string; font?: Partial<ExcelJS.Font> }>,
  baseFont?: Partial<ExcelJS.Font>,
): IDocumentData {
  let dataStream = ''
  const textRuns: Array<{ st: number; ed: number; ts?: Record<string, unknown> }> = []

  function fontToTextStyle(font?: Partial<ExcelJS.Font>): Record<string, unknown> | undefined {
    if (!font || Object.keys(font).length === 0) return undefined
    const ts: Record<string, unknown> = {}
    if (font.bold) ts.bl = BooleanNumber.TRUE
    if (font.italic) ts.it = BooleanNumber.TRUE
    if (font.underline && font.underline !== 'none') {
      ts.ul = { s: BooleanNumber.TRUE }
    }
    if (font.strike) ts.st = { s: BooleanNumber.TRUE }
    if (font.name) ts.ff = font.name
    if (font.size) ts.fs = font.size
    if (font.color?.argb) {
      ts.cl = { rgb: argbToRgb(font.color.argb) }
    }
    return Object.keys(ts).length > 0 ? ts : undefined
  }

  for (const segment of richText) {
    const start = dataStream.length
    dataStream += segment.text
    const end = dataStream.length

    const ts = segment.font
      ? fontToTextStyle({ ...baseFont, ...segment.font })
      : fontToTextStyle(baseFont)

    textRuns.push({ st: start, ed: end, ts })
  }

  dataStream += '\r\n'

  return {
    id: `rich-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body: {
      dataStream,
      textRuns: textRuns.length > 0 ? (textRuns as any) : undefined,
    },
    documentStyle: {},
  }
}

function excelAddressToRC(addr: string): { row: number; col: number } {
  const match = addr.match(/^([A-Z]+)(\d+)$/)
  if (!match) return { row: 0, col: 0 }
  const col = match[1].split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return { row: parseInt(match[2]) - 1, col }
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`
}

function mapCellType(type: ExcelJS.ValueType, value: unknown): CellValueType | undefined {
  switch (type) {
    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.Hyperlink:
    case ExcelJS.ValueType.RichText:
      return CellValueType.STRING
    case ExcelJS.ValueType.Number:
    case ExcelJS.ValueType.Date:
      return CellValueType.NUMBER
    case ExcelJS.ValueType.Boolean:
      return CellValueType.BOOLEAN
    case ExcelJS.ValueType.Null:
    case ExcelJS.ValueType.Merge:
      return undefined
    default:
      return undefined
  }
}

function buildCellStyle(cell: ExcelJS.Cell): IStyleData | undefined {
  const s = cell.style
  const style: IStyleData = {}

  if (s) {
    if (s.numFmt && s.numFmt !== 'General') {
      style.n = { pattern: s.numFmt }
    }
  }

  const font = s?.font
  if (font?.name && !FORCE_DEFAULT_FONT) {
    style.ff = font.name
  } else {
    style.ff = DEFAULT_CELL_FONT
  }
  if (font?.bold) style.bl = BooleanNumber.TRUE
  if (font?.italic) style.it = BooleanNumber.TRUE
  if (font?.underline && font.underline !== 'none') style.ul = { s: BooleanNumber.TRUE }
  if (font?.strike) style.st = { s: BooleanNumber.TRUE }
  if (font?.size) style.fs = font.size
  if (font?.color?.argb) style.cl = { rgb: argbToRgb(font.color.argb) }

  if (s) {
    const fill = s.fill
    if (fill && 'fgColor' in fill && fill.fgColor?.argb) {
      style.bg = { rgb: argbToRgb(fill.fgColor.argb) }
    } else if (fill && 'type' in fill && fill.type === 'pattern' && fill.fgColor?.argb) {
      style.bg = { rgb: argbToRgb(fill.fgColor.argb) }
    }

    const align = s.alignment
    if (align) {
      style.ht = mapHorizontalAlign(align.horizontal)
      style.vt = mapVerticalAlign(align.vertical)
      if (align.wrapText) style.tb = WrapStrategy.WRAP
      if (typeof align.textRotation === 'number') {
        style.tr = { a: align.textRotation, v: BooleanNumber.FALSE }
      }
    }

    const bd = buildBorder(s.border)
    if (bd) style.bd = bd
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function argbToRgb(argb: string): string {
  if (argb.length === 8) return `#${argb.slice(2)}`
  if (argb.length === 6) return `#${argb}`
  return `#${argb}`
}

function mapHorizontalAlign(h: string | undefined): HorizontalAlign | undefined {
  switch (h) {
    case 'left': return HorizontalAlign.LEFT
    case 'center': return HorizontalAlign.CENTER
    case 'right': return HorizontalAlign.RIGHT
    case 'justify': return HorizontalAlign.JUSTIFIED
    case 'distributed': return HorizontalAlign.DISTRIBUTED
    default: return undefined
  }
}

function mapVerticalAlign(v: string | undefined): VerticalAlign | undefined {
  switch (v) {
    case 'top': return VerticalAlign.TOP
    case 'middle': return VerticalAlign.MIDDLE
    case 'bottom': return VerticalAlign.BOTTOM
    default: return undefined
  }
}

function buildBorder(border: Partial<ExcelJS.Borders> | undefined): IStyleData['bd'] | undefined {
  if (!border) return undefined
  const bd: NonNullable<IStyleData['bd']> = {}
  const sides: Array<[keyof typeof bd, keyof ExcelJS.Borders]> = [
    ['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right'],
  ]
  for (const [univerSide, xlsxSide] of sides) {
    const edge = border[xlsxSide]
    if (edge?.style) {
      bd[univerSide] = {
        s: EXCEL_BORDER_MAP[edge.style] ?? BorderStyleTypes.THIN,
        cl: edge.color?.argb ? { rgb: argbToRgb(edge.color.argb) } : { rgb: '#000000' },
      }
    }
  }
  return Object.keys(bd).length > 0 ? bd : undefined
}

const EXCEL_BORDER_MAP: Record<string, BorderStyleTypes> = {
  thin: BorderStyleTypes.THIN,
  hair: BorderStyleTypes.HAIR,
  dotted: BorderStyleTypes.DOTTED,
  dashed: BorderStyleTypes.DASHED,
  dashDot: BorderStyleTypes.DASH_DOT,
  dashDotDot: BorderStyleTypes.DASH_DOT_DOT,
  double: BorderStyleTypes.DOUBLE,
  medium: BorderStyleTypes.MEDIUM,
  mediumDashed: BorderStyleTypes.MEDIUM_DASHED,
  mediumDashDot: BorderStyleTypes.MEDIUM_DASH_DOT,
  mediumDashDotDot: BorderStyleTypes.MEDIUM_DASH_DOT_DOT,
  slantDashDot: BorderStyleTypes.SLANT_DASH_DOT,
  thick: BorderStyleTypes.THICK,
}

function deduplicateStyles(
  cellData: CellMatrix,
  registerStyle: (style: IStyleData) => string,
): void {
  for (const rowKey of Object.keys(cellData)) {
    const row = cellData[Number(rowKey)]
    for (const colKey of Object.keys(row)) {
      const cell = row[Number(colKey)]
      const s = cell.s
      if (s && typeof s === 'object') {
        cell.s = registerStyle(s)
      }
    }
  }
}
