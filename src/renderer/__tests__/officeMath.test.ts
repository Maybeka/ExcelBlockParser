import ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { extractEquationDrawings, extractOfficeMathDefinitions, findEmbeddedOlePreview, mathTypeTextEmfToSvgDataUri, packageMayContainOfficeMathDrawing } from '../services/officeMath'

describe('Office Math extraction', () => {
  it('typesets MathML through the direct source API without browser accessibility services', async () => {
    const [{ mathjax }, { MathML }, { SVG }, { MathJaxNewcmFont }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import('@mathjax/src/mjs/mathjax.js'),
      import('@mathjax/src/mjs/input/mathml.js'),
      import('@mathjax/src/mjs/output/svg.js'),
      import('@mathjax/mathjax-newcm-font/mjs/svg.js'),
      import('@mathjax/src/mjs/adaptors/liteAdaptor.js'),
      import('@mathjax/src/mjs/handlers/html.js'),
    ])
    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const document = mathjax.document('', {
      InputJax: new MathML(),
      OutputJax: new SVG({ fontCache: 'none', fontData: MathJaxNewcmFont }),
    })

    const output = adaptor.outerHTML(document.convert(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mi>y</mi></mfrac></math>',
      { display: false, em: 16, ex: 8, containerWidth: 16_384 },
    ))

    expect(output).toContain('<svg')
    expect(output).not.toMatch(/(?:NaN|Infinity)/i)
  })

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

  it('reads OMML contained in an Office drawing text box', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Sheet1')
    const base = await workbook.xlsx.writeBuffer()
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="rId1"/></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(relationships('rId1', '../drawings/drawing1.xml')),
      'xl/drawings/drawing1.xml': strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>209550</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>120650</xdr:rowOff></xdr:from><xdr:ext cx="1412900" cy="590550"/><xdr:sp><xdr:txBody><a:p><a14:m><m:oMath><m:r><m:t>F</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>ma</m:t></m:r></m:oMath></a14:m></a:p></xdr:txBody></xdr:sp></xdr:oneCellAnchor></xdr:wsDr>`),
    })

    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const definitions = extractOfficeMathDefinitions(files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength), workbook)
      expect(definitions).toEqual([expect.objectContaining({
        sheetName: 'Sheet1',
        from: { column: 1, columnOffset: 22, row: 4, rowOffset: 12.666666666666666 },
        mathMl: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>F</mi><mo>=</mo><mi>ma</mi></mrow></math>',
      })])
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })

  it('preserves group and accent characters from OMML instead of substituting generic accents', () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Math')
    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const definitions = extractOfficeMathDefinitions(officeMathPackage(`
        <m:groupChr><m:groupChrPr><m:chr m:val="⏜"/><m:pos m:val="top"/></m:groupChrPr><m:e><m:r><m:t>ABC</m:t></m:r></m:e></m:groupChr>
        <m:acc><m:accPr><m:chr m:val="⃡"/></m:accPr><m:e><m:r><m:t>AB</m:t></m:r></m:e></m:acc>
      `), workbook)

      expect(definitions[0]?.mathMl).toContain('<mo stretchy="true">⏜</mo>')
      expect(definitions[0]?.mathMl).toContain('<mo stretchy="true">↔</mo>')
      expect(definitions[0]?.mathMl).not.toContain('⏞')
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })

  it('skips Office Math drawings with incomplete anchors or non-finite sheet dimensions', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Math')
    worksheet.getColumn(2).width = Number.NaN
    const base = await workbook.xlsx.writeBuffer()
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Math" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="rId1"/></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(relationships('rId1', '../drawings/drawing1.xml')),
      'xl/drawings/drawing1.xml': strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><m:oMath><m:r><m:t>invalid</m:t></m:r></m:oMath></xdr:twoCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><m:oMath><m:r><m:t>valid</m:t></m:r></m:oMath></xdr:twoCellAnchor></xdr:wsDr>`),
    })
    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const diagnostics: Array<{ sheetName: string | null; message: string }> = []
      const definitions = extractOfficeMathDefinitions(files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength), workbook, diagnostic => diagnostics.push(diagnostic))
      expect(definitions).toHaveLength(1)
      expect(definitions[0]!.mathMl).toContain('valid')
      expect(Number.isFinite(definitions[0]!.width)).toBe(true)
      expect(Number.isFinite(definitions[0]!.height)).toBe(true)
      expect(diagnostics).toEqual([{ sheetName: 'Math', message: expect.stringContaining('invalid drawing anchor') }])
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
      'xl/drawings/vmlDrawing1.vml': strToU8(`<?xml version="1.0"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="_x0000_s1025"><v:imagedata o:relid="rId1"/><x:ClientData ObjectType="Pict"><x:Anchor>1, 0, 2, 0, 3, 0, 5, 0</x:Anchor></x:ClientData></v:shape></xml>`),
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
      'xl/drawings/vmlDrawing1.vml': strToU8(`<?xml version="1.0"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="_x0000_s1025"><v:imagedata o:relid="rId1"/><x:ClientData ObjectType="Pict"><x:Anchor>0, 0, 0, 0, 2, 0, 3, 0</x:Anchor></x:ClientData></v:shape></xml>`),
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

  it('prefers Wails MathType MathML conversion over an EMF preview', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Legacy')
    const base = await workbook.xlsx.writeBuffer()
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Legacy" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><legacyDrawing r:id="rId2"/><oleObjects><oleObject progId="Equation.DSMT4" shapeId="1025" r:id="rId1"/></oleObjects></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`),
      'xl/drawings/vmlDrawing1.vml': strToU8(`<?xml version="1.0"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="_x0000_s1025"><v:imagedata o:relid="rId1"/><x:ClientData ObjectType="Pict"><x:Anchor>0, 0, 0, 0, 2, 0, 3, 0</x:Anchor></x:ClientData></v:shape></xml>`),
      'xl/drawings/_rels/vmlDrawing1.vml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/></Relationships>`),
      'xl/embeddings/oleObject1.bin': Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
      'xl/media/image1.emf': Uint8Array.from([1, 2, 3]),
    })

    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const rasterize = vi.fn()
      const convert = vi.fn(async () => ({ supported: true, mathMl: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>' }))
      const drawings = await extractEquationDrawings(files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength), workbook, rasterize, undefined, convert)
      expect(convert).toHaveBeenCalledOnce()
      expect(rasterize).not.toHaveBeenCalled()
      expect(drawings[0]?.source).toMatch(/^data:image\/svg\+xml;base64,/)
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })

  it('recognizes a MathType Equation.DSMT4 object and prefers its DrawingML anchor', async () => {
    const bytes = await readFile(resolve(process.cwd(), 'tests-native/fixtures/mathtype-equation-dsmt4.xlsx'))
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(source)

    const originalParser = globalThis.DOMParser
    Object.assign(globalThis, { DOMParser: XmlDomParser })
    try {
      const rasterize = vi.fn(async (_preview: ArrayBuffer, extension: string) => {
        expect(extension).toBe('emf')
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer
      })
      const drawings = await extractEquationDrawings(source, workbook, rasterize)

      expect(rasterize).toHaveBeenCalledOnce()
      expect(drawings).toHaveLength(1)
      expect(drawings[0]).toMatchObject({
        sheetName: 'Sheet1', source: 'data:image/png;base64,iVBORw==',
        from: expect.objectContaining({ column: 10, row: 12 }),
      })
      expect(drawings[0]!.from.columnOffset).toBeCloseTo(23.5)
      expect(drawings[0]!.from.rowOffset).toBeCloseTo(2.5)
      expect(drawings[0]!.width).toBeCloseTo(56)
      expect(drawings[0]!.height).toBeCloseTo(21)
    } finally {
      Object.assign(globalThis, { DOMParser: originalParser })
    }
  })

  it('renders MathType text EMF previews from their actual text bounds', async () => {
    const bytes = await readFile(resolve(process.cwd(), 'tests-native/fixtures/mathtype-equation-dsmt4.xlsx'))
    const media = unzipSync(bytes)['xl/media/image1.emf']
    const source = mathTypeTextEmfToSvgDataUri(media, { hasFill: true, hasStroke: true })

    expect(source).toMatch(/^data:image\/svg\+xml;base64,/)
    const svg = new TextDecoder().decode(Uint8Array.from(atob(source!.split(',')[1]!), character => character.charCodeAt(0)))
    expect(svg).toContain('viewBox="6 -3 154 44"')
    expect(svg).toContain('x="10.32" y="33.8"')
    expect(svg).toContain('font-size="36"')
    expect(svg).toContain('>F</text>')
    expect(svg).toContain('>ma</text>')
    expect(svg).toContain('>=</text>')
    expect(svg).toContain('font-style="italic"')
    expect(svg).toContain('stroke="#000000"')
  })

  it('uses a presentation cached inside the OLE object when VML has no image relationship', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Legacy')
    const base = await workbook.xlsx.writeBuffer()
    const olePresentation = new Uint8Array(80)
    olePresentation[0] = 1 // EMR_HEADER
    olePresentation.set([0x20, 0x45, 0x4d, 0x46], 40) // ENHMETAHEADER signature
    olePresentation[48] = 64 // ENHMETAHEADER nBytes
    const files = zipSync({
      ...Object.fromEntries(Object.entries(unzipSync(new Uint8Array(base as ArrayBuffer)))),
      'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Legacy" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><legacyDrawing r:id="rId2"/><oleObjects><oleObject progId="Equation.3" shapeId="1025" r:id="rId1"/></oleObjects></worksheet>`),
      'xl/worksheets/_rels/sheet1.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.bin"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`),
      'xl/drawings/vmlDrawing1.vml': strToU8(`<?xml version="1.0"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1025"><x:ClientData ObjectType="Pict"><x:Anchor>0, 0, 0, 0, 2, 0, 3, 0</x:Anchor></x:ClientData></v:shape></xml>`),
      'xl/embeddings/oleObject1.bin': olePresentation,
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

  it('finds an Equation Editor WMF presentation embedded in its OLE object', () => {
    const presentation = Uint8Array.from([
      0, 0, 0, 0, 0, 0,
      // Placeable WMF header followed by a minimal METAHEADER with mtSize=9.
      0xd7, 0xcd, 0xc6, 0x9a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 9, 0, 0, 3, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])

    const preview = findEmbeddedOlePreview(presentation)

    expect(preview).toEqual(expect.objectContaining({ extension: 'wmf' }))
    expect(preview?.bytes[0]).toBe(0xd7)
  })

  it('reads a presentation stored in an OLE compound-file stream', () => {
    const presentation = new Uint8Array(64)
    presentation.set([0xd7, 0xcd, 0xc6, 0x9a], 0)
    presentation.set([1, 0, 9, 0, 0, 3, 9, 0], 22)

    expect(findEmbeddedOlePreview(compoundFileWithPresentation(presentation))).toEqual(expect.objectContaining({ extension: 'wmf' }))
  })
})

function relationships(id: string, target: string): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/></Relationships>`
}

function officeMathPackage(math: string): ArrayBuffer {
  const files = zipSync({
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Math" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(relationships('rId1', 'worksheets/sheet1.xml')),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><drawing r:id="rId1"/></worksheet>`),
    'xl/worksheets/_rels/sheet1.xml.rels': strToU8(relationships('rId1', '../drawings/drawing1.xml')),
    'xl/drawings/drawing1.xml': strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="952500"/><m:oMath>${math}</m:oMath></xdr:oneCellAnchor></xdr:wsDr>`),
  })
  return files.buffer.slice(files.byteOffset, files.byteOffset + files.byteLength)
}

function compoundFileWithPresentation(presentation: Uint8Array): Uint8Array {
  const sectorSize = 512
  const bytes = new Uint8Array(sectorSize * 4)
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  writeUint16(bytes, 0x1c, 0xfffe)
  writeUint16(bytes, 0x1e, 9)
  writeUint16(bytes, 0x20, 6)
  writeUint32(bytes, 0x2c, 1) // one FAT sector
  writeUint32(bytes, 0x30, 0) // directory sector
  writeUint32(bytes, 0x38, 4096)
  writeUint32(bytes, 0x3c, 0xfffffffe)
  writeUint32(bytes, 0x44, 0xfffffffe)
  writeUint32(bytes, 0x4c, 1) // FAT sector id
  for (let offset = 0x50; offset < 512; offset += 4) writeUint32(bytes, offset, 0xffffffff)
  writeDirectoryEntry(bytes, 512, 'Root Entry', 5, 0xfffffffe, 0)
  writeDirectoryEntry(bytes, 640, '\u0001OlePres000', 2, 2, 4096)
  writeUint32(bytes, 1024, 0xfffffffe)
  writeUint32(bytes, 1028, 0xfffffffe)
  writeUint32(bytes, 1032, 0xfffffffe)
  bytes.set(presentation, 1536)
  return bytes
}

function writeDirectoryEntry(bytes: Uint8Array, offset: number, name: string, type: number, start: number, size: number): void {
  for (let index = 0; index < name.length; index += 1) writeUint16(bytes, offset + index * 2, name.charCodeAt(index))
  writeUint16(bytes, offset + 64, name.length * 2 + 2)
  bytes[offset + 66] = type
  writeUint32(bytes, offset + 116, start)
  writeUint32(bytes, offset + 120, size)
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = value >>> 8
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = value >>> 8
  bytes[offset + 2] = value >>> 16
  bytes[offset + 3] = value >>> 24
}
