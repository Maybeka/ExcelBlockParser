import ExcelJS from 'exceljs'
import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractOfficeMathDefinitions } from '../services/officeMath'

describe('Office Math extraction', () => {
  it('reads an OMML formula from an XLSX drawing and preserves its anchor', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Math')
    const base = await workbook.xlsx.writeBuffer()
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Math" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="rId1"/></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(relationships('rId1', '../drawings/drawing1.xml')),
      'xl/drawings/drawing1.xml': strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:txBody><a:p><m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>y</m:t></m:r></m:den></m:f></m:oMath></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`),
    })

    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const definitions = extractOfficeMathDefinitions(files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength), workbook)
      expect(definitions).toEqual([expect.objectContaining({
        sheetName: 'Math',
        from: { column: 1, columnOffset: 0, row: 2, rowOffset: 0 },
        mathMl: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mfrac><mrow><mi>x</mi></mrow><mrow><mi>y</mi></mrow></mfrac></mrow></math>',
      })])
      expect(definitions[0]!.width).toBeGreaterThan(100)
      expect(definitions[0]!.height).toBeGreaterThan(50)
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })
})

function relationships(id: string, target: string): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/></Relationships>`
}
