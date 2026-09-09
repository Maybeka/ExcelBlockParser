import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import { scanXlsxFormulaDependencies } from '../services/xlsxFormulaDependencies'

const fixturePaths = [
  'examples/empty.xlsx',
  'examples/m2_integration.xlsx',
  'examples/multi_sheet.xlsx',
  'examples/performance_50000.xlsx',
  'examples/test_data.xlsx',
  'examples/test_data_v2.xlsx',
  'tests-native/fixtures/office-math-textbox.xlsx',
]

function countConvertedFormulas(converted: Awaited<ReturnType<typeof convertXlsxToWorkbookData>>): Record<string, number> {
  return Object.fromEntries(converted.workbookData.sheetOrder.map(sheetName => {
    const sheet = converted.workbookData.sheets[sheetName]
    const count = Object.values(sheet?.cellData ?? {}).flatMap(row => Object.values(row)).filter(cell => Boolean(cell.f)).length
    return [sheetName, count]
  }))
}

describe('XLSX dependency scanner integration', () => {
  it.each(fixturePaths)('matches the complete conversion manifest for %s', async fixturePath => {
    const bytes = await readFile(resolve(process.cwd(), fixturePath))
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const previous = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const graph = scanXlsxFormulaDependencies(arrayBuffer)
      const converted = await convertXlsxToWorkbookData(arrayBuffer, fixturePath, { parseImages: false, parseOfficeMath: false })
      expect(graph.sheetNames).toEqual(converted.workbookData.sheetOrder)
      expect(graph.formulaCounts).toEqual(countConvertedFormulas(converted))
      expect(graph.unparseableFormulaSheets).toEqual([])
    } finally {
      Object.assign(globalThis, { DOMParser: previous })
    }
  })
})
