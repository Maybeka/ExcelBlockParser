import { strFromU8 } from 'fflate'
import { convertEmfToDataUrl, convertWmfToDataUrl } from 'emf-converter'
import type ExcelJS from 'exceljs'
import { createXlsxZipReader, readXlsxZipCentralDirectory, readXlsxZipEntries, type XlsxZipEntry } from './xlsxZip'

const EMUS_PER_PIXEL = 9525

export interface OfficeMathDrawing {
  sheetName: string
  source: string
  from: { column: number; columnOffset: number; row: number; rowOffset: number }
  width: number
  height: number
}

export interface LegacyEquationRasterizer {
  (bytes: ArrayBuffer, extension: string): Promise<ArrayBuffer | null>
}

export interface MathTypeOleConversion {
  supported: boolean
  mathMl?: string
  diagnostics?: Array<{ severity: string; offset: number; construct: string; message: string }>
}

export interface MathTypeOleConverter {
  (bytes: ArrayBuffer): Promise<MathTypeOleConversion>
}

export interface OfficeMathDiagnostic {
  sheetName: string | null
  message: string
}

export type OfficeMathDiagnosticReporter = (diagnostic: OfficeMathDiagnostic) => void

interface OfficeMathDefinition extends Omit<OfficeMathDrawing, 'source'> {
  mathMl: string
}

let mathJaxDocument: Promise<MathJaxDocument> | null = null

interface MathJaxDocument {
  convert(mathMl: string, options: { display: boolean; em: number; ex: number; containerWidth: number }): unknown
  serialize?: (node: unknown) => string
}

export async function extractOfficeMathDrawings(arrayBuffer: ArrayBuffer, workbook: ExcelJS.Workbook, report?: OfficeMathDiagnosticReporter): Promise<OfficeMathDrawing[]> {
  const definitions = extractOfficeMathDefinitions(arrayBuffer, workbook, report)
  if (definitions.length === 0) return []
  const drawings: OfficeMathDrawing[] = []
  for (const definition of definitions) {
    try {
      drawings.push({ ...definition, source: await mathMlToSvgDataUri(definition.mathMl, definition.width, definition.height) })
    } catch (error) {
      console.warn('[OfficeMath] Unable to render equation:', error)
      report?.({ sheetName: definition.sheetName, message: `Office Math equation could not be rendered: ${errorMessage(error)}` })
    }
  }
  return drawings
}

/**
 * Extract both modern OMML equations and legacy OLE equation previews.
 * Equation Editor 3.0 and MathType Equation.DSMT* objects are not OMML.
 * Excel stores their on-sheet preview in VML and, on Windows, that preview is
 * commonly an EMF or WMF image.
 */
export async function extractEquationDrawings(
  arrayBuffer: ArrayBuffer,
  workbook: ExcelJS.Workbook,
  rasterizeLegacyPreview?: LegacyEquationRasterizer,
  report?: OfficeMathDiagnosticReporter,
  convertMathTypeOle?: MathTypeOleConverter,
): Promise<OfficeMathDrawing[]> {
  const [officeMath, legacyEquations] = await Promise.all([
    extractOfficeMathDrawings(arrayBuffer, workbook, report),
    extractLegacyEquationDrawings(arrayBuffer, workbook, rasterizeLegacyPreview, report, convertMathTypeOle),
  ])
  return [...officeMath, ...legacyEquations]
}

export function extractOfficeMathDefinitions(arrayBuffer: ArrayBuffer, workbook: ExcelJS.Workbook, report?: OfficeMathDiagnosticReporter): OfficeMathDefinition[] {
  if (typeof DOMParser === 'undefined') return []
  const bytes = new Uint8Array(arrayBuffer)
  const packageEntries = readXlsxZipEntries(bytes)
  // Most workbooks do not contain DrawingML at all. Avoid inflating every part
  // of a large XLSX package just to establish that it cannot contain OMML.
  if (packageEntries && ![...packageEntries.keys()].some(isDrawingXmlPathText)) return []
  const files = createXlsxZipReader(bytes, packageEntries)

  const workbookDocument = parseXml(files.get('xl/workbook.xml'))
  const workbookRelationships = parseRelationships(files.get('xl/_rels/workbook.xml.rels'))
  if (!workbookDocument) return []

  const definitions: OfficeMathDefinition[] = []
  for (const sheet of elementsByName(workbookDocument, 'sheet')) {
    const sheetName = sheet.getAttribute('name')
    const sheetRelationshipId = getRelationshipId(sheet)
    const sheetTarget = sheetRelationshipId ? workbookRelationships.get(sheetRelationshipId) : undefined
    const worksheet = sheetName ? workbook.getWorksheet(sheetName) : undefined
    if (!sheetName || !sheetTarget || !worksheet) continue

    const worksheetPath = resolvePackagePath('xl/workbook.xml', sheetTarget)
    const worksheetRelationships = parseRelationships(files.get(relationshipPathFor(worksheetPath)))
    const drawingTargets = new Set(
      [...worksheetRelationships.values()]
        .map(target => resolvePackagePath(worksheetPath, target))
        .filter(isDrawingXmlPathText),
    )

    for (const drawingTarget of drawingTargets) {
      const drawingBytes = files.get(drawingTarget)
      // Old Equation Editor objects have VML/OLE previews but no OMML. Do not
      // build a DOM for every large drawing part unless it contains an equation.
      if (!drawingBytes || !decodeXml(drawingBytes).includes('oMath')) continue
      const drawingDocument = parseXml(drawingBytes)
      if (!drawingDocument) continue

      for (const math of elementsByName(drawingDocument, 'oMath')) {
        const anchor = findAnchor(math)
        const geometry = anchor ? anchorGeometry(anchor, worksheet) : null
        if (!geometry) {
          report?.({ sheetName, message: 'Office Math equation has an invalid drawing anchor and was not displayed.' })
          continue
        }
        definitions.push({ sheetName, mathMl: ommlToMathMl(math), ...geometry })
      }
    }
  }
  return definitions
}

async function extractLegacyEquationDrawings(
  arrayBuffer: ArrayBuffer,
  workbook: ExcelJS.Workbook,
  rasterizeLegacyPreview?: LegacyEquationRasterizer,
  report?: OfficeMathDiagnosticReporter,
  convertMathTypeOle?: MathTypeOleConverter,
): Promise<OfficeMathDrawing[]> {
  if (typeof DOMParser === 'undefined') return []
  const bytes = new Uint8Array(arrayBuffer)
  const entries = readXlsxZipEntries(bytes)
  if (entries && ![...entries.keys()].some(path => path.startsWith('xl/embeddings/') || path.endsWith('.vml'))) return []
  const files = createXlsxZipReader(bytes, entries)
  const workbookDocument = parseXml(files.get('xl/workbook.xml'))
  if (!workbookDocument) return []
  const workbookRelationships = parseRelationships(files.get('xl/_rels/workbook.xml.rels'))
  const drawings: OfficeMathDrawing[] = []

  for (const sheet of elementsByName(workbookDocument, 'sheet')) {
    const sheetName = sheet.getAttribute('name')
    const sheetRelationshipId = getRelationshipId(sheet)
    const sheetTarget = sheetRelationshipId ? workbookRelationships.get(sheetRelationshipId) : undefined
    const worksheet = sheetName ? workbook.getWorksheet(sheetName) : undefined
    if (!sheetName || !sheetTarget || !worksheet) continue

    const worksheetPath = resolvePackagePath('xl/workbook.xml', sheetTarget)
    const worksheetDocument = parseXml(files.get(worksheetPath))
    if (!worksheetDocument) continue
    // Excel writes the same OLE object into both Choice and Fallback under
    // mc:AlternateContent. The VML shape and relationship identify one object.
    const legacyObjectsByKey = new Map<string, Element>()
    for (const object of elementsByName(worksheetDocument, 'oleObject')) {
      if (!isLegacyEquationObject(object.getAttribute('progId'))) continue
      const key = `${object.getAttribute('shapeId')}:${getRelationshipId(object)}`
      if (!legacyObjectsByKey.has(key)) legacyObjectsByKey.set(key, object)
    }
    const legacyObjects = [...legacyObjectsByKey.values()]
    if (legacyObjects.length === 0) continue

    const worksheetRelationships = parseRelationships(files.get(relationshipPathFor(worksheetPath)))
    const legacyDrawing = elementsByName(worksheetDocument, 'legacyDrawing')[0]
    const legacyDrawingId = legacyDrawing ? getRelationshipId(legacyDrawing) : null
    const legacyDrawingTarget = legacyDrawingId ? worksheetRelationships.get(legacyDrawingId) : undefined
    if (!legacyDrawingTarget) {
      console.warn('[Equation.3] No VML preview drawing was found for legacy equation objects.', { sheetName, count: legacyObjects.length })
      report?.({ sheetName, message: 'Equation Editor 3.0 object has no VML preview and was not displayed.' })
      continue
    }

    const vmlPath = resolvePackagePath(worksheetPath, legacyDrawingTarget)
    const vmlDocument = parseXml(files.get(vmlPath))
    const vmlRelationships = parseRelationships(files.get(relationshipPathFor(vmlPath)))
    if (!vmlDocument) continue

    for (const object of legacyObjects) {
      const shape = findLegacyEquationShape(vmlDocument, object.getAttribute('shapeId'))
      const imageData = shape ? elementsByName(shape, 'imagedata')[0] : undefined
      const imageRelationshipId = imageData ? getRelationshipId(imageData) : null
      const imageTarget = imageRelationshipId ? vmlRelationships.get(imageRelationshipId) : undefined
      const geometry = shape ? legacyEquationGeometry(object, shape, worksheet) : null
      if (!shape || !geometry) {
        console.warn('[Equation.3] Unable to resolve a positioned equation object.', { sheetName, shapeId: object.getAttribute('shapeId') })
        report?.({ sheetName, message: 'Equation Editor 3.0 object has an invalid drawing anchor and was not displayed.' })
        continue
      }

      const vmlPreview = imageTarget ? files.get(resolvePackagePath(vmlPath, imageTarget)) : undefined
      const vmlExtension = imageTarget?.split('.').pop()?.toLowerCase() ?? ''
      // Some Excel versions put only the placement in VML. The preview itself
      // then lives in the OLE compound file (normally its OlePres stream).
      const objectRelationshipId = getRelationshipId(object)
      const objectTarget = objectRelationshipId ? worksheetRelationships.get(objectRelationshipId) : undefined
      const objectBytes = objectTarget ? files.get(resolvePackagePath(worksheetPath, objectTarget)) : undefined
      const embeddedPreview = !vmlPreview && objectBytes ? findEmbeddedOlePreview(objectBytes) : undefined
      const previewBytes = vmlPreview ?? embeddedPreview?.bytes
      const extension = vmlPreview ? vmlExtension : embeddedPreview?.extension ?? ''
      let source: string | undefined
      let conversion: MathTypeOleConversion | undefined
      if (objectBytes && convertMathTypeOle) {
        try {
          conversion = await convertMathTypeOle(toArrayBuffer(objectBytes))
          if (conversion.supported && conversion.mathMl) {
            source = await mathMlToSvgDataUri(conversion.mathMl, geometry.width, geometry.height)
          }
        } catch (error) {
          console.warn('[MathType] Unable to convert embedded OLE equation.', { sheetName, error })
        }
      }
      if (!source && previewBytes) {
        source = await legacyPreviewSource(previewBytes, extension, rasterizeLegacyPreview, {
          sheetName,
          extension,
          appearance: legacyEquationAppearance(shape),
        })
      }
      if (!source) {
        const diagnostic = conversion?.diagnostics?.[0]
        const detail = diagnostic ? `: ${diagnostic.message}` : ''
        console.warn('[Equation.3] Preview format is not renderable in this runtime.', { sheetName, extension, diagnostic })
        report?.({ sheetName, message: `Legacy equation could not be converted or rendered${detail}` })
        continue
      }
      drawings.push({ sheetName, source, ...geometry })
    }
  }
  return drawings
}

async function legacyPreviewSource(
  previewBytes: Uint8Array,
  extension: string,
  rasterizeLegacyPreview: LegacyEquationRasterizer | undefined,
  context: { sheetName: string; extension: string; appearance?: LegacyEquationAppearance },
): Promise<string | undefined> {
  let source = imageDataUri(previewBytes, extension)
  if (!source && rasterizeLegacyPreview && ['emf', 'wmf'].includes(extension)) {
    try {
      const rasterized = await rasterizeLegacyPreview(toArrayBuffer(previewBytes), extension)
      if (rasterized) source = imageDataUri(new Uint8Array(rasterized), 'png')
    } catch (error) {
      console.warn('[Equation.3] Unable to rasterize preview image.', { ...context, error })
    }
  }
  // MathType's Windows preview commonly contains GDI text with its final
  // coordinates in EMR_EXTTEXTOUTW.rclBounds. Some generic EMF renderers use
  // only ptlReference (often 0,0), clipping every glyph at the canvas edge.
  // Keep the platform rasterizer first when one is available: it has the
  // original native fonts and therefore remains the highest-fidelity option.
  if (!source && extension === 'emf') source = mathTypeTextEmfToSvgDataUri(previewBytes, context.appearance)
  if (!source && ['emf', 'wmf'].includes(extension)) {
    try {
      source = extension === 'emf'
        ? await convertEmfToDataUrl(toArrayBuffer(previewBytes), { dpiScale: 1 })
        : await convertWmfToDataUrl(toArrayBuffer(previewBytes), { dpiScale: 1 })
    } catch (error) {
      console.warn('[LegacyEquation] Unable to render metafile preview in the renderer.', { ...context, error })
    }
  }
  return source
}

interface EmfTextFont {
  family: string
  italic: boolean
  height: number
}

interface LegacyEquationAppearance {
  hasFill: boolean
  hasStroke: boolean
}

/**
 * Render the text-only EMF flavour written by MathType. This is deliberately
 * narrow: malformed records and non-text EMFs fall back to the general
 * metafile conversion path.
 */
export function mathTypeTextEmfToSvgDataUri(bytes: Uint8Array, appearance?: LegacyEquationAppearance): string | undefined {
  if (bytes.length < 108 || readUint32(bytes, 0) !== 1 || readUint32(bytes, 4) < 108) return undefined
  const left = readInt32(bytes, 8)
  const top = readInt32(bytes, 12)
  const right = readInt32(bytes, 16)
  const bottom = readInt32(bytes, 20)
  const width = right - left
  const height = bottom - top
  if (![left, top, right, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined

  const fonts = new Map<number, EmfTextFont>()
  const textRuns: Array<{ left: number; bottom: number; height: number; fontSize: number; family: string; italic: boolean; text: string }> = []
  let selectedFont: EmfTextFont | undefined
  let windowExtentY = height
  let viewportExtentY = height
  let offset = readUint32(bytes, 4)
  while (offset + 8 <= bytes.length) {
    const type = readUint32(bytes, offset)
    const size = readUint32(bytes, offset + 4)
    if (size < 8 || offset + size > bytes.length) return undefined
    const data = offset + 8
    if (type === 82 && size >= 368) {
      const handle = readUint32(bytes, data)
      const face = readUtf16(bytes, data + 32, 64).replace(/\0.*$/, '').trim()
      if (face) fonts.set(handle, { family: face, italic: bytes[data + 24] !== 0, height: readInt32(bytes, data + 4) })
    } else if (type === 37 && size >= 12) {
      selectedFont = fonts.get(readUint32(bytes, data))
    } else if (type === 9 && size >= 16) {
      windowExtentY = readInt32(bytes, data + 4)
    } else if (type === 11 && size >= 16) {
      viewportExtentY = readInt32(bytes, data + 4)
    } else if (type === 84 && size >= 76 && selectedFont) {
      const runLeft = readInt32(bytes, data)
      const runTop = readInt32(bytes, data + 4)
      const runBottom = readInt32(bytes, data + 12)
      const characterCount = readUint32(bytes, data + 36)
      const stringOffset = readUint32(bytes, data + 40)
      const stringStart = offset + stringOffset
      const runHeight = runBottom - runTop
      if (characterCount === 0 || stringOffset === 0 || stringStart + characterCount * 2 > offset + size || runHeight <= 0) return undefined
      textRuns.push({
        left: runLeft,
        bottom: runBottom,
        height: runHeight,
        fontSize: Math.abs(selectedFont.height * viewportExtentY / (windowExtentY || 1)),
        family: selectedFont.family,
        italic: selectedFont.italic,
        text: normalizeMathTypeSymbolText(readUtf16(bytes, stringStart, characterCount * 2), selectedFont.family),
      })
    }
    if (type === 14) break
    offset += size
  }
  if (textRuns.length === 0) return undefined

  const content = textRuns.map(run => {
    // Use the LOGFONT height after the EMF's active coordinate mapping. The
    // bounds are used only as a fallback for malformed producer output.
    const fontSize = Number.isFinite(run.fontSize) && run.fontSize > 0
      ? Math.round(run.fontSize * 100) / 100
      : Math.max(1, Math.round(run.height * 0.86 * 100) / 100)
    const fontStyle = run.italic ? ' font-style="italic"' : ''
    // GDI's bounds enclose glyphs while SVG positions text by baseline. Its
    // default ascent otherwise puts the formula against the lower-left edge.
    const x = Math.round((run.left + fontSize * 0.12) * 100) / 100
    const y = Math.round((run.bottom - fontSize * 0.2) * 100) / 100
    return `<text x="${x}" y="${y}" font-family="${escapeXml(run.family)}, serif" font-size="${fontSize}" fill="#000000"${fontStyle}>${escapeXml(run.text)}</text>`
  }).join('')
  const background = appearance?.hasFill ? `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#ffffff"/>` : ''
  const border = appearance?.hasStroke ? `<rect x="${left + 0.5}" y="${top + 0.5}" width="${width - 1}" height="${height - 1}" fill="none" stroke="#000000"/>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}">${background}${border}${content}</svg>`
  return `data:image/svg+xml;base64,${toBase64(svg)}`
}

function normalizeMathTypeSymbolText(text: string, family: string): string {
  if (!/^symbol$/i.test(family)) return text
  // MathType stores classic Symbol glyph codes in the private-use area. The
  // low byte is the character code expected by the Symbol font.
  return [...text].map(character => {
    const codePoint = character.codePointAt(0)!
    return codePoint >= 0xf000 && codePoint <= 0xf0ff ? String.fromCharCode(codePoint & 0xff) : character
  }).join('')
}

function legacyEquationAppearance(shape: Element): LegacyEquationAppearance {
  return {
    hasFill: shape.getAttribute('filled') !== 'f',
    hasStroke: shape.getAttribute('stroked') !== 'f',
  }
}

interface EmbeddedOlePreview {
  bytes: Uint8Array
  extension: 'png' | 'jpg' | 'gif' | 'bmp' | 'emf' | 'wmf'
}

/**
 * Equation Editor 3.0 is an OLE compound document. Its cached presentation is
 * commonly a WMF/EMF payload in its OlePres000 presentation stream. Scanning for a validated image
 * header also supports producer variants which store the stream in mini FAT
 * sectors without requiring a full CFB parser in the renderer.
 */
export function findEmbeddedOlePreview(bytes: Uint8Array): EmbeddedOlePreview | undefined {
  const presentationStreams = readCompoundFileStreams(bytes)
    .filter(stream => /^\u0001OlePres\d+$/i.test(stream.name))
    .map(stream => stream.bytes)
  for (const stream of presentationStreams) {
    const preview = findImagePayload(stream)
    if (preview) return preview
  }
  // Retain this fallback for producer variants with a malformed compound-file
  // directory. It is intentionally secondary: mini-FAT streams are not safe to
  // recover by scanning the container as a whole.
  return findImagePayload(bytes)
}

interface CompoundFileStream {
  name: string
  bytes: Uint8Array
}

function readCompoundFileStreams(bytes: Uint8Array): CompoundFileStream[] {
  const freeSector = 0xffffffff
  const endOfChain = 0xfffffffe
  if (!matches(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return []
  const sectorSize = 1 << readUint16(bytes, 0x1e)
  const miniSectorSize = 1 << readUint16(bytes, 0x20)
  if (![512, 4096].includes(sectorSize) || miniSectorSize !== 64) return []
  const firstDirectorySector = readUint32(bytes, 0x30)
  const miniStreamCutoff = readUint32(bytes, 0x38)
  const firstMiniFatSector = readUint32(bytes, 0x3c)
  const miniFatSectorCount = readUint32(bytes, 0x40)
  const firstDifatSector = readUint32(bytes, 0x44)
  const difatSectorCount = readUint32(bytes, 0x48)
  const sector = (id: number) => {
    const offset = (id + 1) * sectorSize
    return offset >= sectorSize && offset + sectorSize <= bytes.length ? bytes.subarray(offset, offset + sectorSize) : undefined
  }
  const difat: number[] = []
  for (let index = 0; index < 109; index += 1) {
    const id = readUint32(bytes, 0x4c + index * 4)
    if (id !== freeSector) difat.push(id)
  }
  let difatSector = firstDifatSector
  for (let count = 0; count < difatSectorCount && difatSector !== endOfChain && difatSector !== freeSector; count += 1) {
    const data = sector(difatSector)
    if (!data) return []
    for (let index = 0; index < sectorSize / 4 - 1; index += 1) {
      const id = readUint32(data, index * 4)
      if (id !== freeSector) difat.push(id)
    }
    difatSector = readUint32(data, sectorSize - 4)
  }
  const fat = concatBytes(difat.map(sector).filter((value): value is Uint8Array => !!value))
  if (fat.length === 0) return []
  const fatAt = (id: number) => id >= 0 && id * 4 + 4 <= fat.length ? readUint32(fat, id * 4) : endOfChain
  const readChain = (start: number, unitSize: number, next: (id: number) => number, source: (id: number) => Uint8Array | undefined, maximum = 1_000_000) => {
    const parts: Uint8Array[] = []
    const seen = new Set<number>()
    for (let id = start; id !== endOfChain && id !== freeSector && !seen.has(id) && seen.size < maximum; id = next(id)) {
      const value = source(id)
      if (!value) return new Uint8Array()
      seen.add(id)
      parts.push(value.subarray(0, unitSize))
    }
    return concatBytes(parts)
  }
  const directory = readChain(firstDirectorySector, sectorSize, fatAt, sector)
  if (directory.length === 0) return []
  const entries: Array<{ name: string; type: number; start: number; size: number }> = []
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const length = readUint16(directory, offset + 64)
    const type = directory[offset + 66] ?? 0
    if (![2, 5].includes(type) || length < 2 || length > 64) continue
    const name = new TextDecoder('utf-16le').decode(directory.subarray(offset, offset + length - 2))
    const size = readUint32(directory, offset + 120) + readUint32(directory, offset + 124) * 0x1_0000_0000
    entries.push({ name, type, start: readUint32(directory, offset + 116), size })
  }
  const root = entries.find(entry => entry.type === 5)
  if (!root) return []
  const miniStream = readChain(root.start, sectorSize, fatAt, sector).subarray(0, root.size)
  const miniFat = readChain(firstMiniFatSector, sectorSize, fatAt, sector).subarray(0, miniFatSectorCount * sectorSize)
  const miniFatAt = (id: number) => id >= 0 && id * 4 + 4 <= miniFat.length ? readUint32(miniFat, id * 4) : endOfChain
  const miniSector = (id: number) => {
    const offset = id * miniSectorSize
    return offset >= 0 && offset + miniSectorSize <= miniStream.length ? miniStream.subarray(offset, offset + miniSectorSize) : undefined
  }
  return entries.filter(entry => entry.type === 2).map(entry => ({
    name: entry.name,
    bytes: (entry.size < miniStreamCutoff
      ? readChain(entry.start, miniSectorSize, miniFatAt, miniSector)
      : readChain(entry.start, sectorSize, fatAt, sector)).subarray(0, entry.size),
  }))
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function findImagePayload(bytes: Uint8Array): EmbeddedOlePreview | undefined {
  for (let offset = 0; offset < bytes.length - 8; offset += 1) {
    if (matches(bytes, offset, [0x89, 0x50, 0x4e, 0x47])) return { bytes: bytes.subarray(offset), extension: 'png' }
    if (matches(bytes, offset, [0xff, 0xd8, 0xff])) return { bytes: bytes.subarray(offset), extension: 'jpg' }
    if (matches(bytes, offset, [0x47, 0x49, 0x46, 0x38])) return { bytes: bytes.subarray(offset), extension: 'gif' }
    if (matches(bytes, offset, [0x42, 0x4d])) {
      const size = readUint32(bytes, offset + 2)
      return { bytes: bytes.subarray(offset, validEmbeddedLength(bytes, offset, size)), extension: 'bmp' }
    }
    // ENHMETAFILEHEADER: record type 1 and the ASCII signature " EMF" at +40.
    if (readUint32(bytes, offset) === 1 && matches(bytes, offset + 40, [0x20, 0x45, 0x4d, 0x46])) {
      return { bytes: bytes.subarray(offset, validEmbeddedLength(bytes, offset, readUint32(bytes, offset + 48))), extension: 'emf' }
    }
    const placeableWmf = matches(bytes, offset, [0xd7, 0xcd, 0xc6, 0x9a])
    const metaOffset = placeableWmf ? offset + 22 : offset
    if (metaOffset + 18 <= bytes.length && (readUint16(bytes, metaOffset) === 1 || readUint16(bytes, metaOffset) === 2) && readUint16(bytes, metaOffset + 2) === 9) {
      const size = readUint32(bytes, metaOffset + 6) * 2 + (placeableWmf ? 22 : 0)
      if (size >= 18) return { bytes: bytes.subarray(offset, validEmbeddedLength(bytes, offset, size)), extension: 'wmf' }
    }
  }
  return undefined
}

function matches(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  return offset >= 0 && offset + signature.length <= bytes.length && signature.every((value, index) => bytes[offset + index] === value)
}

function validEmbeddedLength(bytes: Uint8Array, offset: number, length: number): number {
  return Number.isFinite(length) && length > 0 && offset + length <= bytes.length ? offset + length : bytes.length
}

function isLegacyEquationObject(programId: string | null): boolean {
  if (!programId) return false
  return /^(?:Equation(?:\.3)?|Equation\.DSMT\d+)$/i.test(programId.trim())
}

function findLegacyEquationShape(document: Document, shapeId: string | null): Element | undefined {
  if (!shapeId) return undefined
  return elementsByName(document, 'shape').find(shape => {
    const id = shape.getAttribute('id') ?? ''
    return id === shapeId || id.endsWith(`s${shapeId}`)
  })
}

function legacyShapeGeometry(shape: Element, worksheet: ExcelJS.Worksheet): Omit<OfficeMathDrawing, 'sheetName' | 'source'> | null {
  const clientData = elementsByName(shape, 'ClientData')[0]
  const anchor = clientData ? elementsByName(clientData, 'Anchor')[0]?.textContent : null
  if (!anchor) return null
  const values = anchor.split(',').map(value => Number(value.trim()))
  if (values.length !== 8 || values.some(value => !Number.isFinite(value))) return null
  const [fromColumn, fromColumnUnit, fromRow, fromRowUnit, toColumn, toColumnUnit, toRow, toRowUnit] = values
  const from = {
    column: fromColumn!,
    columnOffset: (fromColumnUnit! / 1024) * columnPixelWidth(worksheet, fromColumn!),
    row: fromRow!,
    rowOffset: (fromRowUnit! / 256) * rowPixelHeight(worksheet, fromRow!),
  }
  const to = {
    column: toColumn!,
    columnOffset: (toColumnUnit! / 1024) * columnPixelWidth(worksheet, toColumn!),
    row: toRow!,
    rowOffset: (toRowUnit! / 256) * rowPixelHeight(worksheet, toRow!),
  }
  const size = anchorRangeSize(from, to, worksheet)
  return size && size.width > 0 && size.height > 0 ? { from, ...size } : null
}

function legacyEquationGeometry(object: Element, shape: Element, worksheet: ExcelJS.Worksheet): Omit<OfficeMathDrawing, 'sheetName' | 'source'> | null {
  const objectProperties = childByName(object, 'objectPr')
  const drawingAnchor = objectProperties ? childByName(objectProperties, 'anchor') : null
  // Newer Excel producers retain a DrawingML objectPr anchor alongside the
  // VML preview. Prefer it because VML's legacy grid units can be inconsistent.
  return (drawingAnchor ? anchorGeometry(drawingAnchor, worksheet) : null) ?? legacyShapeGeometry(shape, worksheet)
}

function imageDataUri(bytes: Uint8Array, extension: string): string | undefined {
  const mimeType = imageMimeType(extension)
  if (!mimeType) return undefined
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

function imageMimeType(extension: string): string | undefined {
  switch (extension.toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'svg': return 'image/svg+xml'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    default: return undefined
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true)
}

function readUtf16(bytes: Uint8Array, offset: number, byteLength: number): string {
  return new TextDecoder('utf-16le').decode(bytes.subarray(offset, offset + byteLength))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * Inspect only the ZIP central directory. Returning true on an unfamiliar or
 * malformed package keeps extraction conservative: it may do extra work, but
 * never drops a possible Office Math drawing.
 */
export function packageMayContainOfficeMathDrawing(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer)
  const entries = readXlsxZipEntries(bytes)
  return !entries || [...entries.keys()].some(isDrawingXmlPathText)
}

/**
 * Produces an XLSX package that ExcelJS can load without image or drawing
 * parts. It copies compressed entries directly; no worksheet XML or cell data
 * is inflated just to disable image parsing for diagnostics.
 */
export function stripEmbeddedImagesFromXlsx(arrayBuffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(arrayBuffer)
  const directory = readXlsxZipCentralDirectory(bytes)
  const entries = readXlsxZipEntries(bytes)
  if (!directory || !entries || entries.size > 0xffff) return arrayBuffer

  const ordered = [...entries.entries()]
    .map(([path, entry]) => ({ path, entry }))
    .sort((left, right) => left.entry.offset - right.entry.offset)
  // VML drawings under `xl/drawings/` carry legacy cell comments. Removing
  // them leaves comment relationships pointing at a missing part, which makes
  // ExcelJS fail while reconciling worksheet comments. Only remove the image
  // media and modern DrawingML XML parts used for image placement.
  const kept = ordered.filter(({ path }) => !path.startsWith('xl/media/') && !isDrawingXmlPathText(path))
  if (kept.length === ordered.length) return arrayBuffer

  const localParts: Uint8Array[] = []
  const newOffsets = new Map<XlsxZipEntry, number>()
  let localSize = 0
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!
    if (!kept.includes(current)) continue
    const nextOffset = ordered[index + 1]?.entry.offset ?? directory.offset
    if (current.entry.offset >= nextOffset || nextOffset > bytes.length) return arrayBuffer
    newOffsets.set(current.entry, localSize)
    const part = bytes.slice(current.entry.offset, nextOffset)
    localParts.push(part)
    localSize += part.length
  }

  const centralParts: Uint8Array[] = []
  let centralSize = 0
  const centralOrdered = [...entries.entries()]
    .map(([path, entry]) => ({ path, entry }))
    .sort((left, right) => left.entry.centralOffset - right.entry.centralOffset)
  for (let index = 0; index < centralOrdered.length; index += 1) {
    const current = centralOrdered[index]!
    const offset = newOffsets.get(current.entry)
    if (offset === undefined) continue
    const nextOffset = centralOrdered[index + 1]?.entry.centralOffset ?? directory.offset + directory.size
    if (current.entry.centralOffset >= nextOffset || nextOffset > bytes.length) return arrayBuffer
    const part = bytes.slice(current.entry.centralOffset, nextOffset)
    new DataView(part.buffer, part.byteOffset, part.byteLength).setUint32(42, offset, true)
    centralParts.push(part)
    centralSize += part.length
  }

  const endPart = bytes.slice(directory.endOffset)
  if (endPart.length < 22 || localSize > 0xffffffff || centralSize > 0xffffffff) return arrayBuffer
  const endView = new DataView(endPart.buffer, endPart.byteOffset, endPart.byteLength)
  endView.setUint16(8, kept.length, true)
  endView.setUint16(10, kept.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, localSize, true)

  const output = new Uint8Array(localSize + centralSize + endPart.length)
  let outputOffset = 0
  for (const part of [...localParts, ...centralParts, endPart]) {
    output.set(part, outputOffset)
    outputOffset += part.length
  }
  return output.buffer
}

function isDrawingXmlPathText(path: string): boolean {
  return path.startsWith('xl/drawings/') && path.endsWith('.xml')
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
}

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null
  const document = new DOMParser().parseFromString(decodeXml(bytes), 'application/xml')
  return elementsByName(document, 'parsererror').length > 0 ? null : document
}

function decodeXml(bytes: Uint8Array): string {
  return strFromU8(bytes)
}

function parseRelationships(bytes: Uint8Array | undefined): Map<string, string> {
  const document = parseXml(bytes)
  const relationships = new Map<string, string>()
  if (!document) return relationships
  for (const relationship of elementsByName(document, 'Relationship')) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target) relationships.set(id, target)
  }
  return relationships
}

function elementsByName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(element => element.localName === localName)
}

function getRelationshipId(element: Element): string | null {
  return element.getAttribute('r:id')
    ?? element.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    ?? element.getAttribute('o:relid')
    ?? element.getAttributeNS('urn:schemas-microsoft-com:office:office', 'relid')
}

function relationshipPathFor(partPath: string): string {
  const parts = partPath.split('/')
  const fileName = parts.pop()
  return `${parts.join('/')}/_rels/${fileName}.rels`
}

function resolvePackagePath(fromPath: string, target: string): string {
  const parts = fromPath.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function findAnchor(element: Element): Element | null {
  let current: Element | null = element
  while (current) {
    if (['twoCellAnchor', 'oneCellAnchor'].includes(current.localName)) return current
    current = current.parentElement
  }
  return null
}

function anchorGeometry(anchor: Element, worksheet: ExcelJS.Worksheet): Omit<OfficeMathDrawing, 'sheetName' | 'source'> | null {
  const from = childByName(anchor, 'from')
  if (!from) return null
  const position = anchorPosition(from, worksheet)
  if (!position) return null
  const to = childByName(anchor, 'to')
  const ext = childByName(anchor, 'ext')
  const size = to ? anchorRangeSize(position, anchorPosition(to, worksheet), worksheet)
    : ext ? extentGeometry(ext)
      : null
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return null
  return { from: position, width: size.width, height: size.height }
}

function childByName(element: Element, localName: string): Element | null {
  return Array.from(element.children).find(child => child.localName === localName) ?? null
}

function anchorPosition(anchor: Element, worksheet: ExcelJS.Worksheet): OfficeMathDrawing['from'] | null {
  const column = childFiniteNumber(anchor, 'col')
  const row = childFiniteNumber(anchor, 'row')
  const columnOffsetEmu = childFiniteNumber(anchor, 'colOff')
  const rowOffsetEmu = childFiniteNumber(anchor, 'rowOff')
  if (column === null || row === null || columnOffsetEmu === null || rowOffsetEmu === null || column < 0 || row < 0) return null
  // DrawingML anchors store offsets in EMUs while Univer's drawing facade
  // expects pixels. Passing the raw EMU values moves a formula far away from
  // its source cell, commonly beyond the visible canvas.
  return {
    column,
    columnOffset: columnOffsetEmu / EMUS_PER_PIXEL,
    row,
    rowOffset: rowOffsetEmu / EMUS_PER_PIXEL,
  }
}

function extentGeometry(extent: Element): { width: number; height: number } | null {
  const width = finiteNumber(extent.getAttribute('cx'))
  const height = finiteNumber(extent.getAttribute('cy'))
  if (width === null || height === null) return null
  return { width: width / EMUS_PER_PIXEL, height: height / EMUS_PER_PIXEL }
}

function childFiniteNumber(element: Element, localName: string): number | null {
  return finiteNumber(childByName(element, localName)?.textContent ?? null)
}

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function anchorRangeSize(from: OfficeMathDrawing['from'], to: OfficeMathDrawing['from'] | null, worksheet: ExcelJS.Worksheet): { width: number; height: number } | null {
  if (!to) return null
  return {
    width: axisDistance(from.column, from.columnOffset, to.column, to.columnOffset, index => columnPixelWidth(worksheet, index)),
    height: axisDistance(from.row, from.rowOffset, to.row, to.rowOffset, index => rowPixelHeight(worksheet, index)),
  }
}

function axisDistance(start: number, startOffset: number, end: number, endOffset: number, sizeAt: (index: number) => number): number {
  if (![start, startOffset, end, endOffset].every(Number.isFinite) || end < start || (end === start && endOffset <= startOffset)) return 0
  let size = -startOffset + endOffset
  for (let index = start; index < end; index += 1) size += sizeAt(index)
  return Number.isFinite(size) ? size : 0
}

function columnPixelWidth(worksheet: ExcelJS.Worksheet, index: number): number {
  const width = worksheet.getColumn(index + 1).width
  return Number.isFinite(width) && width! > 0 ? width! * 8 : 8.43 * 8
}

function rowPixelHeight(worksheet: ExcelJS.Worksheet, index: number): number {
  const height = worksheet.getRow(index + 1).height
  return Number.isFinite(height) && height! > 0 ? height! * 1.333 : 15 * 1.333
}

function ommlToMathMl(math: Element): string {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow>${ommlChildren(math)}</mrow></math>`
}

function ommlChildren(element: Element): string {
  return Array.from(element.children).map(ommlElement).join('')
}

function ommlElement(element: Element): string {
  const child = (name: string) => {
    const match = childByName(element, name)
    return match ? `<mrow>${ommlChildren(match)}</mrow>` : '<mrow/>'
  }
  switch (element.localName) {
    case 't': return mathToken(element.textContent ?? '')
    case 'r': return ommlChildren(element)
    case 'f': return `<mfrac>${child('num')}${child('den')}</mfrac>`
    case 'sSup': return `<msup>${child('e')}${child('sup')}</msup>`
    case 'sSub': return `<msub>${child('e')}${child('sub')}</msub>`
    case 'sSubSup': return `<msubsup>${child('e')}${child('sub')}${child('sup')}</msubsup>`
    case 'rad': return `<msqrt>${child('e')}</msqrt>`
    case 'limLow': return `<munder>${child('e')}${child('lim')}</munder>`
    case 'limUpp': return `<mover>${child('e')}${child('lim')}</mover>`
    case 'nary': {
      const operator = childByName(childByName(element, 'naryPr') ?? element, 'chr')?.getAttribute('m:val')
        ?? childByName(childByName(element, 'naryPr') ?? element, 'chr')?.getAttribute('val')
        ?? '∑'
      return `<munderover><mo>${escapeXml(operator)}</mo>${child('sub')}${child('sup')}</munderover>${child('e')}`
    }
    case 'd': {
      const properties = childByName(element, 'dPr')
      const opening = childByName(properties ?? element, 'begChr')?.getAttribute('m:val') ?? childByName(properties ?? element, 'begChr')?.getAttribute('val') ?? '('
      const closing = childByName(properties ?? element, 'endChr')?.getAttribute('m:val') ?? childByName(properties ?? element, 'endChr')?.getAttribute('val') ?? ')'
      return `<mfenced open="${escapeXml(opening)}" close="${escapeXml(closing)}">${child('e')}</mfenced>`
    }
    case 'func': return `<mrow>${child('fName')}<mo>⁡</mo>${child('e')}</mrow>`
    case 'bar': {
      const properties = childByName(element, 'barPr')
      const position = childByName(properties ?? element, 'pos')?.getAttribute('m:val') ?? childByName(properties ?? element, 'pos')?.getAttribute('val') ?? 'top'
      const operator = childByName(properties ?? element, 'chr')?.getAttribute('m:val') ?? childByName(properties ?? element, 'chr')?.getAttribute('val') ?? '¯'
      return accentedMathMl(child('e'), operator, position, true)
    }
    case 'groupChr': {
      const properties = childByName(element, 'groupChrPr')
      const position = childByName(properties ?? element, 'pos')?.getAttribute('m:val') ?? childByName(properties ?? element, 'pos')?.getAttribute('val') ?? 'top'
      const operator = childByName(properties ?? element, 'chr')?.getAttribute('m:val') ?? childByName(properties ?? element, 'chr')?.getAttribute('val') ?? '⏞'
      return accentedMathMl(child('e'), operator, position, true)
    }
    case 'acc': {
      const properties = childByName(element, 'accPr')
      const operator = childByName(properties ?? element, 'chr')?.getAttribute('m:val') ?? childByName(properties ?? element, 'chr')?.getAttribute('val') ?? 'ˆ'
      // U+20E1 is a combining left-right arrow. MathJax treats it as a fixed
      // accent, while Office stretches it over the complete expression.
      const renderedOperator = operator === '⃡' ? '↔' : operator
      return accentedMathMl(child('e'), renderedOperator, 'top', operator === '⃡')
    }
    case 'm': return `<mtable>${ommlChildren(element)}</mtable>`
    case 'mr': return `<mtr>${ommlChildren(element)}</mtr>`
    case 'e': return `<mtd>${ommlChildren(element)}</mtd>`
    default: return ommlChildren(element)
  }
}

function mathToken(value: string): string {
  const escaped = escapeXml(value)
  return /^[+\-*/=<>≤≥×÷∑∫√()\[\],.]$/.test(value) ? `<mo>${escaped}</mo>` : `<mi>${escaped}</mi>`
}

function accentedMathMl(base: string, operator: string, position: string, stretchy: boolean): string {
  const accent = `<mo${stretchy ? ' stretchy="true"' : ''}>${escapeXml(operator)}</mo>`
  return position === 'bot'
    ? `<munder accentunder="true">${base}${accent}</munder>`
    : `<mover accent="true">${base}${accent}</mover>`
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

async function mathMlToSvgDataUri(mathMl: string, width: number, height: number): Promise<string> {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Office Math drawing has invalid SVG geometry')
  }
  const mathJax = await loadMathJax()
  const container = mathJax.convert(mathMl, { display: false, em: 16, ex: 8, containerWidth: 16_384 })
  if (isHtmlContainer(container)) {
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('MathJax did not produce an SVG')
    assertValidSvgGeometry(svg)
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', `${width}px`)
    svg.setAttribute('height', `${height}px`)
    svg.setAttribute('preserveAspectRatio', 'xMinYMid meet')
    return `data:image/svg+xml;base64,${toBase64(svg.outerHTML)}`
  }
  if (!mathJax.serialize) throw new Error('MathJax did not provide an SVG container')
  const serialized = mathJax.serialize(container)
  const start = serialized.indexOf('<svg')
  const end = serialized.indexOf('</svg>', start)
  if (start < 0 || end < 0) throw new Error('MathJax did not produce an SVG')
  const svg = serialized.slice(start, end + '</svg>'.length)
  if (/(?:^|[^a-z])(?:nan|infinity)(?:$|[^a-z])/i.test(svg)) throw new Error('MathJax produced invalid SVG geometry')
  const withGeometry = svg.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${width}px" height="${height}px" preserveAspectRatio="xMinYMid meet"`)
  return `data:image/svg+xml;base64,${toBase64(withGeometry)}`
}

function isHtmlContainer(value: unknown): value is HTMLElement {
  return !!value && typeof (value as HTMLElement).querySelector === 'function'
}

async function loadMathJax(): Promise<MathJaxDocument> {
  if (!mathJaxDocument) {
    // Use MathJax's source API instead of its browser component loader. The
    // latter bundles optional SRE accessibility services and may try to fetch
    // speech-worker.js; this document only converts MathML to static SVG.
    mathJaxDocument = Promise.all([
      import('@mathjax/src/mjs/mathjax.js'),
      import('@mathjax/src/mjs/input/mathml.js'),
      import('@mathjax/src/mjs/output/svg.js'),
      import('@mathjax/src/mjs/adaptors/browserAdaptor.js'),
      import('@mathjax/src/mjs/handlers/html.js'),
      import('@mathjax/mathjax-newcm-font/mjs/svg.js'),
    ]).then(async ([{ mathjax }, { MathML }, { SVG }, { browserAdaptor }, { RegisterHTMLHandler }, { MathJaxNewcmFont }]) => {
      const adaptor = typeof document === 'undefined'
        ? (await import('@mathjax/src/mjs/adaptors/liteAdaptor.js')).liteAdaptor()
        : browserAdaptor()
      RegisterHTMLHandler(adaptor)
      const mathDocument = mathjax.document(typeof document === 'undefined' ? '' : document, {
        InputJax: new MathML(),
        OutputJax: new SVG({ fontCache: 'none', fontData: MathJaxNewcmFont }),
      })
      return {
        convert: mathDocument.convert.bind(mathDocument),
        serialize: typeof document === 'undefined' ? adaptor.outerHTML.bind(adaptor) : undefined,
      } as MathJaxDocument
    })
  }
  return mathJaxDocument
}

function assertValidSvgGeometry(svg: SVGSVGElement): void {
  const geometryAttributes = new Set(['width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'viewBox'])
  for (const element of [svg, ...svg.querySelectorAll<SVGElement>('*')]) {
    for (const attribute of element.getAttributeNames()) {
      const value = element.getAttribute(attribute)
      if (geometryAttributes.has(attribute) && value?.match(/(?:^|[^a-z])(?:nan|infinity)(?:$|[^a-z])/i)) {
        throw new Error(`MathJax produced invalid SVG ${attribute}="${value}"`)
      }
    }
  }
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
