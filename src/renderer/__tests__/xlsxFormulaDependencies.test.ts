import ExcelJS from 'exceljs'
import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import { formulaDependencyClosure, scanXlsxFormulaDependencies } from '../services/xlsxFormulaDependencies'
import { readXlsxZipEntries } from '../services/xlsxZip'

async function scan(workbook: ExcelJS.Workbook) {
  const buffer = await workbook.xlsx.writeBuffer()
  return scanBuffer(buffer as ArrayBuffer, true)
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function scanBuffer(buffer: ArrayBuffer, includeFull = false) {
  const previous = globalThis.DOMParser
  Object.assign(globalThis, { DOMParser: XmlDomParser })
  try {
    return {
      graph: scanXlsxFormulaDependencies(buffer),
      ...(includeFull ? { full: await convertXlsxToWorkbookData(buffer, 'dependencies.xlsx', { parseImages: false, parseOfficeMath: false }) } : {}),
    }
  } finally {
    Object.assign(globalThis, { DOMParser: previous })
  }
}

describe('XLSX formula dependency scanner', () => {
  it('matches the complete converter sheet manifest and resolves transitive dependencies', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs').getCell('A1').value = 2
    workbook.addWorksheet('Rate Table').getCell('B2').value = 3
    workbook.addWorksheet('Summary').getCell('A1').value = { formula: "Inputs!A1 * 'Rate Table'!B2", result: 6 }
    workbook.addWorksheet('Dashboard').getCell('A1').value = { formula: 'Summary!A1 + Inputs!A1', result: 8 }

    const { graph, full } = await scan(workbook)

    expect(graph.sheetNames).toEqual(['Inputs', 'Rate Table', 'Summary', 'Dashboard'])
    expect(graph.sheetNames).toEqual(full.workbookData.sheetOrder)
    expect(graph.dependencies).toEqual({
      Inputs: [],
      'Rate Table': [],
      Summary: ['Inputs', 'Rate Table'],
      Dashboard: ['Inputs', 'Summary'],
    })
    expect(formulaDependencyClosure(graph, 'Dashboard')).toEqual(['Inputs', 'Rate Table', 'Summary', 'Dashboard'])
  })

  it('resolves workbook and worksheet-scoped defined names without treating functions as names', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs').getCell('A1').value = 5
    const report = workbook.addWorksheet('Report')
    report.getCell('A1').value = { formula: 'SUM(BaseRate, 1)', result: 6 }
    workbook.definedNames.add('Inputs!$A$1', 'BaseRate')

    const { graph } = await scan(workbook)

    expect(graph.dependencies.Report).toEqual(['Inputs'])
    expect(graph.dynamicReferenceSheets).toEqual([])
    expect(graph.unparseableFormulaSheets).toEqual([])
  })

  it('expands three-dimensional references in workbook order', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Jan').getCell('A1').value = 1
    workbook.addWorksheet('Feb').getCell('A1').value = 2
    workbook.addWorksheet('Mar').getCell('A1').value = 3
    workbook.addWorksheet('Total').getCell('A1').value = { formula: 'SUM(Jan:Mar!A1)', result: 6 }

    const { graph } = await scan(workbook)

    expect(graph.dependencies.Total).toEqual(['Jan', 'Feb', 'Mar'])
  })

  it('handles escaped apostrophes in quoted sheet references', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("O'Brien").getCell('A1').value = 7
    workbook.addWorksheet('Report').getCell('A1').value = { formula: "'O''Brien'!A1", result: 7 }

    const { graph } = await scan(workbook)

    expect(graph.dependencies.Report).toEqual(["O'Brien"])
    expect(formulaDependencyClosure(graph, 'Report')).toEqual(["O'Brien", 'Report'])
  })

  it('resolves same-named worksheet-scoped definitions against the formula sheet', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs A').getCell('A1').value = 2
    workbook.addWorksheet('Inputs B').getCell('A1').value = 3
    workbook.addWorksheet('Report A').getCell('A1').value = { formula: 'LocalRate', result: 2 }
    workbook.addWorksheet('Report B').getCell('A1').value = { formula: 'LocalRate', result: 3 }
    const entries = unzipSync(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer))
    const workbookPath = 'xl/workbook.xml'
    entries[workbookPath] = strToU8(strFromU8(entries[workbookPath]!).replace('</workbook>', [
      '<definedNames>',
      '<definedName name="LocalRate" localSheetId="2">\'Inputs A\'!$A$1</definedName>',
      '<definedName name="LocalRate" localSheetId="3">\'Inputs B\'!$A$1</definedName>',
      '</definedNames>',
      '</workbook>',
    ].join('')))

    const { graph } = await scanBuffer(asArrayBuffer(zipSync(entries)))

    expect(graph.dependencies['Report A']).toEqual(['Inputs A'])
    expect(graph.dependencies['Report B']).toEqual(['Inputs B'])
  })

  it('maps structured table references to their owning worksheet', async () => {
    const workbook = new ExcelJS.Workbook()
    const data = workbook.addWorksheet('Data')
    data.addTable({
      name: 'Orders',
      ref: 'A1:B2',
      columns: [{ name: 'Item' }, { name: 'Amount' }],
      rows: [['A', 4]],
    })
    workbook.addWorksheet('Report').getCell('A1').value = { formula: 'SUM(Orders[Amount])', result: 4 }

    const { graph } = await scan(workbook)

    expect(graph.dependencies.Report).toEqual(['Data'])
    expect(graph.unresolvedStructuredReferenceSheets).toEqual([])
  })

  it('uses shared-formula masters for follower cells without formula text', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs').getCell('A1').value = 3
    const report = workbook.addWorksheet('Report')
    report.fillFormula('A1:A3', 'Inputs!A1 * 2', [6, 6, 6])

    const { graph } = await scan(workbook)

    expect(graph.dependencies.Report).toEqual(['Inputs'])
    expect(graph.unparseableFormulaSheets).toEqual([])
    expect(graph.formulaCounts.Report).toBe(3)
  })

  it('does not mistake string literals for sheet references and marks opaque references', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs').getCell('A1').value = 5
    const report = workbook.addWorksheet('Report')
    report.getCell('A1').value = { formula: '"Inputs!A1"', result: 'Inputs!A1' }
    report.getCell('A2').value = { formula: 'OFFSET(Inputs!A1, 0, 0)', result: 5 }
    report.getCell('A3').value = { formula: '[External.xlsx]Other!A1', result: 4 }
    report.getCell('A4').value = { formula: 'INDIRECT("Inputs!A1")', result: 5 }

    const { graph } = await scan(workbook)

    expect(graph.dependencies.Report).toEqual(['Inputs'])
    expect(graph.dynamicReferenceSheets).toEqual(['Report'])
    expect(graph.externalReferenceSheets).toEqual(['Report'])
    expect(graph.unparseableFormulaSheets).toEqual([])
    expect(graph.formulaCounts).toEqual({ Inputs: 0, Report: 4 })
  })

  it('keeps circular references finite and includes every member in the dependency closure', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Alpha').getCell('A1').value = { formula: 'Beta!A1', result: 1 }
    workbook.addWorksheet('Beta').getCell('A1').value = { formula: 'Alpha!A1', result: 1 }

    const { graph } = await scan(workbook)

    expect(graph.dependencies).toEqual({ Alpha: ['Beta'], Beta: ['Alpha'] })
    expect(formulaDependencyClosure(graph, 'Alpha')).toEqual(['Alpha', 'Beta'])
  })

  it('does not classify an incomplete formula as dependency-free', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Inputs').getCell('A1').value = 1
    workbook.addWorksheet('Report').getCell('A1').value = { formula: 'Inputs!A1', result: 1 }
    const source = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer)
    const entries = unzipSync(source)
    const worksheetPath = 'xl/worksheets/sheet2.xml'
    entries[worksheetPath] = strToU8(strFromU8(entries[worksheetPath]!).replace('<f>Inputs!A1</f>', '<f>SUM(</f>'))
    const { graph } = await scanBuffer(asArrayBuffer(zipSync(entries)))

    expect(graph.dependencies.Report).toEqual([])
    expect(graph.unparseableFormulaSheets).toEqual(['Report'])
  })

  it('rejects an XLSX package without workbook metadata', () => {
    const previous = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      expect(() => scanXlsxFormulaDependencies(new Uint8Array([1, 2, 3]).buffer)).toThrow()
    } finally {
      Object.assign(globalThis, { DOMParser: previous })
    }
  })

  it('does not inflate unrelated package entries while scanning formula metadata', () => {
    const archive = zipSync({
      'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'),
      'xl/media/unrelated.bin': strToU8('This entry must never be decompressed by formula metadata scanning.'.repeat(50)),
    }, { level: 6 })
    const bytes = archive.slice()
    const entry = readXlsxZipEntries(bytes)?.get('xl/media/unrelated.bin')
    expect(entry?.compressionMethod).toBe(8)
    const nameLength = bytes[entry!.offset + 26]! | (bytes[entry!.offset + 27]! << 8)
    const extraLength = bytes[entry!.offset + 28]! | (bytes[entry!.offset + 29]! << 8)
    bytes[entry!.offset + 30 + nameLength + extraLength] = 0xff

    const previous = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      expect(scanXlsxFormulaDependencies(asArrayBuffer(bytes))).toMatchObject({
        sheetNames: ['Data'],
        dependencies: { Data: [] },
      })
    } finally {
      Object.assign(globalThis, { DOMParser: previous })
    }
  })
})
