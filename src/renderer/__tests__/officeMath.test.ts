import ExcelJS from 'exceljs'
import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { extractEquationDrawings, extractOfficeMathDefinitions, packageMayContainOfficeMathDrawing } from '../services/officeMath'

describe('Office Math extraction', () => {
  it('skips package inflation when the ZIP directory has no drawing XML', () => {
    const noDrawings = zipSync({ 'xl/worksheets/sheet1.xml': strToU8('<worksheet/>') })
    const drawing = zipSync({ 'xl/drawings/drawing1.xml': strToU8('<drawing/>') })

    expect(packageMayContainOfficeMathDrawing(noDrawings.buffer.slice(noDrawings.byteOffset, noDrawings.byteOffset + noDrawings.byteLength))).toBe(false)
    expect(packageMayContainOfficeMathDrawing(drawing.buffer.slice(drawing.byteOffset, drawing.byteOffset + drawing.byteLength))).toBe(true)
  })

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

  it('renders an Equation Editor 3.0 OLE object from its VML preview image', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Legacy')
    const base = await workbook.xlsx.writeBuffer()
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Legacy" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><legacyDrawing r:id="rId2"/><oleObjects><oleObject progId="Equation.3" shapeId="1025" r:id="rId1"/></oleObjects></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`),
      'xl/drawings/vmlDrawing1.vml': strToU8(`<?xml version="1.0"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><v:shape id="_x0000_s1025"><v:imagedata r:id="rId1"/><x:ClientData ObjectType="Pict"><x:Anchor>1, 0, 2, 0, 3, 0, 5, 0</x:Anchor></x:ClientData></v:shape></xml>`),
      'xl/drawings/_rels/vmlDrawing1.vml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`),
      'xl/embeddings/oleObject1.bin': Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
      'xl/media/image1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    })

    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const drawings = await extractEquationDrawings(files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength), workbook)
      expect(drawings).toEqual([expect.objectContaining({
        sheetName: 'Legacy',
        source: 'data:image/png;base64,iVBORw==',
        from: { column: 1, columnOffset: 0, row: 2, rowOffset: 0 },
      })])
      expect(drawings[0]!.width).toBeGreaterThan(100)
      expect(drawings[0]!.height).toBeGreaterThan(40)
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })

  it('uses the Windows rasterizer for an Equation Editor vector preview', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Legacy')
    const base = await workbook.xlsx.writeBuffer()
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Legacy" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><legacyDrawing r:id="rId2"/><oleObjects><oleObject progId="Equation.3" shapeId="1025" r:id="rId1"/></oleObjects></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`),
      'xl/drawings/vmlDrawing1.vml': strToU8(`<?xml version="1.0"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><v:shape id="_x0000_s1025"><v:imagedata r:id="rId1"/><x:ClientData ObjectType="Pict"><x:Anchor>0, 0, 0, 0, 2, 0, 3, 0</x:Anchor></x:ClientData></v:shape></xml>`),
      'xl/drawings/_rels/vmlDrawing1.vml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/></Relationships>`),
      'xl/embeddings/oleObject1.bin': Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
      'xl/media/image1.emf': Uint8Array.from([1, 2, 3]),
    })

    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const rasterize = vi.fn(async (_preview: ArrayBuffer, extension: string) => {
        expect(extension).toBe('emf')
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer
      })
      const drawings = await extractEquationDrawings(files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength), workbook, rasterize)
      expect(rasterize).toHaveBeenCalledOnce()
      expect(drawings[0]?.source).toBe('data:image/png;base64,iVBORw==')
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })
})

function relationships(id: string, target: string): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/></Relationships>`
}
