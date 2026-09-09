import ExcelJS from 'exceljs'
import { DOMParser as XmlDomParser, XMLSerializer as XmlSerializer } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import {
  convertStagedXlsxToWorkbookData,
  LatestStagedLoadCoordinator,
  materializeStagedWorkbookPackage,
  planStagedWorkbookLoad,
} from '../services/xlsxStagedParser'

function withXmlRuntime<T>(callback: () => T): T {
  const parser = globalThis.DOMParser
  const serializer = globalThis.XMLSerializer
  Object.assign(globalThis, { DOMParser: XmlDomParser, XMLSerializer: XmlSerializer })
  try {
    return callback()
  } finally {
    Object.assign(globalThis, { DOMParser: parser, XMLSerializer: serializer })
  }
}

async function withXmlRuntimeAsync<T>(callback: () => Promise<T>): Promise<T> {
  const parser = globalThis.DOMParser
  const serializer = globalThis.XMLSerializer
  Object.assign(globalThis, { DOMParser: XmlDomParser, XMLSerializer: XmlSerializer })
  try {
    return await callback()
  } finally {
    Object.assign(globalThis, { DOMParser: parser, XMLSerializer: serializer })
  }
}

function workbookBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

function comparableSheets(converted: Awaited<ReturnType<typeof convertXlsxToWorkbookData>>) {
  return {
    sheets: converted.workbookData.sheets,
    sheetOrder: converted.workbookData.sheetOrder,
    styles: converted.workbookData.styles,
    sheetDisplaySettings: converted.sheetDisplaySettings,
    sheetSelections: converted.sheetSelections,
    sheetTabColors: converted.sheetTabColors,
  }
}

describe('staged XLSX parser', () => {
  it('retains the active worksheet, transitive formula inputs, and their exact converted data', async () => {
    const workbook = new ExcelJS.Workbook()
    const inputs = workbook.addWorksheet('Inputs')
    inputs.getCell('A1').value = 3
    const rates = workbook.addWorksheet('Rates')
    rates.getCell('A1').value = 4
    const dashboard = workbook.addWorksheet('Dashboard')
    dashboard.getCell('A1').value = { formula: 'Inputs!A1 * Rates!A1', result: 12 }
    const notes = workbook.addWorksheet('Notes')
    notes.getCell('A1').value = 'This worksheet must not be loaded in the staged package.'
    workbook.views = [{ activeTab: 2 }]
    const source = await workbookBuffer(workbook)

    const staged = await withXmlRuntimeAsync(() => convertStagedXlsxToWorkbookData(source, 'staged.xlsx', 'Dashboard', { parseImages: false, parseOfficeMath: false }))
    const full = await convertXlsxToWorkbookData(source, 'full.xlsx', { parseImages: false, parseOfficeMath: false })

    expect(staged.plan).toMatchObject({ mode: 'staged', sheetNames: ['Inputs', 'Rates', 'Dashboard'], fallbackReasons: [] })
    expect(staged.conversion.activeSheetName).toBe('Dashboard')
    expect(comparableSheets(staged.conversion)).toEqual({
      sheets: Object.fromEntries(staged.plan.sheetNames.map(name => [name, full.workbookData.sheets[name]])),
      sheetOrder: staged.plan.sheetNames,
      styles: full.workbookData.styles,
      sheetDisplaySettings: Object.fromEntries(staged.plan.sheetNames.map(name => [name, full.sheetDisplaySettings[name]])),
      sheetSelections: Object.fromEntries(staged.plan.sheetNames.map(name => [name, full.sheetSelections[name]]).filter(([, selection]) => selection != null)),
      sheetTabColors: Object.fromEntries(staged.plan.sheetNames.map(name => [name, full.sheetTabColors[name]]).filter(([, color]) => color != null)),
    })

    const packageBytes = withXmlRuntime(() => new Uint8Array(materializeStagedWorkbookPackage(source, staged.plan)))
    const packageFiles = unzipSync(packageBytes)
    expect(strFromU8(packageFiles['xl/workbook.xml']!)).not.toContain('Notes')
    expect(packageFiles['xl/worksheets/sheet4.xml']).toBeUndefined()
  })

  it('falls back to the complete workbook when the active closure has opaque formula references', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs').getCell('A1').value = 3
    const dashboard = workbook.addWorksheet('Dashboard')
    dashboard.getCell('A1').value = { formula: 'INDIRECT("Inputs!A1")', result: 3 }
    const source = await workbookBuffer(workbook)

    const plan = withXmlRuntime(() => planStagedWorkbookLoad(source, 'Dashboard'))
    const packageBuffer = withXmlRuntime(() => materializeStagedWorkbookPackage(source, plan))

    expect(plan).toMatchObject({ mode: 'full', sheetNames: ['Inputs', 'Dashboard'] })
    expect(plan.fallbackReasons).toEqual(['dynamic references: Dashboard'])
    expect(packageBuffer).not.toBe(source)
    expect(new Uint8Array(packageBuffer)).toEqual(new Uint8Array(source))
  })

  it('retains worksheet relationship targets needed by the selected sheet', async () => {
    const workbook = new ExcelJS.Workbook()
    const selected = workbook.addWorksheet('Selected')
    const imageId = workbook.addImage({ buffer: Buffer.from('not-a-real-image'), extension: 'png' })
    selected.addImage(imageId, 'A1:B2')
    workbook.addWorksheet('Excluded').getCell('A1').value = 'ignored'
    const source = await workbookBuffer(workbook)

    const plan = withXmlRuntime(() => planStagedWorkbookLoad(source, 'Selected'))
    const packageBytes = withXmlRuntime(() => new Uint8Array(materializeStagedWorkbookPackage(source, plan)))
    const files = unzipSync(packageBytes)

    expect(plan).toMatchObject({ mode: 'staged', sheetNames: ['Selected'] })
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/drawings/drawing1.xml',
      'xl/media/image1.png',
    ]))
    expect(files['xl/worksheets/sheet2.xml']).toBeUndefined()
  })

  it('discards a stale background parse after a newer workbook request starts', async () => {
    const coordinator = new LatestStagedLoadCoordinator()
    let resolveFirst: ((value: string) => void) | undefined
    const first = coordinator.run(() => new Promise<string>(resolve => { resolveFirst = resolve }))
    const second = coordinator.run(async () => 'new workbook')
    resolveFirst?.('old workbook')

    await expect(first).resolves.toEqual({ status: 'stale' })
    await expect(second).resolves.toEqual({ status: 'current', value: 'new workbook' })
  })
})
