import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DOMParser as XmlDomParser, XMLSerializer as XmlSerializer } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import { scanXlsxFormulaDependencies } from '../services/xlsxFormulaDependencies'
import { convertStagedXlsxToWorkbookData, planStagedWorkbookLoad } from '../services/xlsxStagedParser'

const fixturePaths = [
  'examples/empty.xlsx',
  'examples/m2_integration.xlsx',
  'examples/multi_sheet.xlsx',
  'examples/performance_50000.xlsx',
  'examples/test_data.xlsx',
  'examples/test_data_v2.xlsx',
  'tests-native/fixtures/office-math-textbox.xlsx',
]

async function withXmlRuntime<T>(callback: () => Promise<T>): Promise<T> {
  const parser = globalThis.DOMParser
  const serializer = globalThis.XMLSerializer
  Object.assign(globalThis, { DOMParser: XmlDomParser, XMLSerializer: XmlSerializer })
  try {
    return await callback()
  } finally {
    Object.assign(globalThis, { DOMParser: parser, XMLSerializer: serializer })
  }
}

function selectedEntries<T>(source: Record<string, T>, names: string[]): Record<string, T> {
  return Object.fromEntries(names.flatMap(name => source[name] === undefined ? [] : [[name, source[name]]]))
}

describe('staged XLSX parser integration', () => {
  it.each(fixturePaths)('matches the complete conversion for the staged closure of %s', async fixturePath => {
    const bytes = await readFile(resolve(process.cwd(), fixturePath))
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const options = { parseImages: false, parseOfficeMath: false }

    await withXmlRuntime(async () => {
      const planSeed = planStagedWorkbookLoad(source, planSheetName(source))
      const staged = await convertStagedXlsxToWorkbookData(source, fixturePath, planSeed.activeSheetName, options)
      const complete = await convertXlsxToWorkbookData(source, fixturePath, options)
      const names = staged.plan.sheetNames

      expect(staged.conversion.workbookData.sheetOrder).toEqual(names)
      expect(staged.conversion.workbookData.sheets).toEqual(selectedEntries(complete.workbookData.sheets, names))
      expect(staged.conversion.workbookData.styles).toEqual(complete.workbookData.styles)
      expect(staged.conversion.sheetDisplaySettings).toEqual(selectedEntries(complete.sheetDisplaySettings, names))
      expect(staged.conversion.sheetSelections).toEqual(selectedEntries(complete.sheetSelections, names))
      expect(staged.conversion.sheetTabColors).toEqual(selectedEntries(complete.sheetTabColors, names))
    })
  })

  it('matches complete image and Office Math extraction for the selected real worksheet', async () => {
    const fixturePath = 'tests-native/fixtures/office-math-textbox.xlsx'
    const bytes = await readFile(resolve(process.cwd(), fixturePath))
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

    await withXmlRuntime(async () => {
      const activeSheetName = planSheetName(source)
      const staged = await convertStagedXlsxToWorkbookData(source, fixturePath, activeSheetName)
      const complete = await convertXlsxToWorkbookData(source, fixturePath)

      expect(staged.plan.mode).toBe('staged')
      expect(staged.conversion.images).toEqual(complete.images.filter(image => staged.plan.sheetNames.includes(image.sheetName)))
      expect(staged.conversion.diagnostics).toEqual(complete.diagnostics.filter(diagnostic => !diagnostic.sheetName || staged.plan.sheetNames.includes(diagnostic.sheetName)))
    })
  })
})

function planSheetName(arrayBuffer: ArrayBuffer): string {
  // The final visible sheet tends to exercise the largest formula closure while
  // keeping the fixture matrix bounded for pre-merge verification.
  return scanXlsxFormulaDependencies(arrayBuffer).sheetNames.at(-1) ?? ''
}
