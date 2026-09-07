import { inflateSync, strFromU8, unzipSync } from 'fflate'
import type ExcelJS from 'exceljs'

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

interface OfficeMathDefinition extends Omit<OfficeMathDrawing, 'source'> {
  mathMl: string
}

let mathJaxReady: Promise<MathJaxRuntime> | null = null

interface MathJaxRuntime {
  startup: { promise: Promise<unknown> }
  typesetPromise(elements?: Element[]): Promise<unknown>
}

declare global {
  interface Window { MathJax?: MathJaxRuntime }
}

export async function extractOfficeMathDrawings(arrayBuffer: ArrayBuffer, workbook: ExcelJS.Workbook): Promise<OfficeMathDrawing[]> {
  const definitions = extractOfficeMathDefinitions(arrayBuffer, workbook)
  if (definitions.length === 0) return []
  const drawings: OfficeMathDrawing[] = []
  for (const definition of definitions) {
    try {
      drawings.push({ ...definition, source: await mathMlToSvgDataUri(definition.mathMl, definition.width, definition.height) })
    } catch (error) {
      console.warn('[OfficeMath] Unable to render equation:', error)
    }
  }
  return drawings
}

/**
 * Extract both modern OMML equations and Equation Editor 3.0 OLE previews.
 * Legacy Equation.3 objects are not OMML. Excel stores their on-sheet preview
 * in VML and, on Windows, that preview is commonly an EMF or WMF image.
 */
export async function extractEquationDrawings(
  arrayBuffer: ArrayBuffer,
  workbook: ExcelJS.Workbook,
  rasterizeLegacyPreview?: LegacyEquationRasterizer,
): Promise<OfficeMathDrawing[]> {
  const [officeMath, legacyEquations] = await Promise.all([
    extractOfficeMathDrawings(arrayBuffer, workbook),
    extractLegacyEquationDrawings(arrayBuffer, workbook, rasterizeLegacyPreview),
  ])
  return [...officeMath, ...legacyEquations]
}

export function extractOfficeMathDefinitions(arrayBuffer: ArrayBuffer, workbook: ExcelJS.Workbook): OfficeMathDefinition[] {
  if (typeof DOMParser === 'undefined') return []
  const bytes = new Uint8Array(arrayBuffer)
  const packageEntries = readZipEntries(bytes)
  // Most workbooks do not contain DrawingML at all. Avoid inflating every part
  // of a large XLSX package just to establish that it cannot contain OMML.
  if (packageEntries && ![...packageEntries.keys()].some(isDrawingXmlPathText)) return []
  const files = packageEntries ? new SelectiveZipReader(bytes, packageEntries) : new LegacyZipReader(bytes)

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
        if (!geometry) continue
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
): Promise<OfficeMathDrawing[]> {
  if (typeof DOMParser === 'undefined') return []
  const bytes = new Uint8Array(arrayBuffer)
  const entries = readZipEntries(bytes)
  if (entries && ![...entries.keys()].some(path => path.startsWith('xl/embeddings/') || path.endsWith('.vml'))) return []
  const files = entries ? new SelectiveZipReader(bytes, entries) : new LegacyZipReader(bytes)
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
    const legacyObjects = elementsByName(worksheetDocument, 'oleObject')
      .filter(object => isEquationEditorObject(object.getAttribute('progId')))
    if (legacyObjects.length === 0) continue

    const worksheetRelationships = parseRelationships(files.get(relationshipPathFor(worksheetPath)))
    const legacyDrawing = elementsByName(worksheetDocument, 'legacyDrawing')[0]
    const legacyDrawingId = legacyDrawing ? getRelationshipId(legacyDrawing) : null
    const legacyDrawingTarget = legacyDrawingId ? worksheetRelationships.get(legacyDrawingId) : undefined
    if (!legacyDrawingTarget) {
      console.warn('[Equation.3] No VML preview drawing was found for legacy equation objects.', { sheetName, count: legacyObjects.length })
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
      const geometry = shape ? legacyShapeGeometry(shape, worksheet) : null
      if (!shape || !imageTarget || !geometry) {
        console.warn('[Equation.3] Unable to resolve a positioned preview image.', { sheetName, shapeId: object.getAttribute('shapeId') })
        continue
      }

      const previewPath = resolvePackagePath(vmlPath, imageTarget)
      const previewBytes = files.get(previewPath)
      if (!previewBytes) continue
      const extension = previewPath.split('.').pop()?.toLowerCase() ?? ''
      let source = imageDataUri(previewBytes, extension)
      if (!source && rasterizeLegacyPreview && ['emf', 'wmf'].includes(extension)) {
        try {
          const rasterized = await rasterizeLegacyPreview(toArrayBuffer(previewBytes), extension)
          if (rasterized) source = imageDataUri(new Uint8Array(rasterized), 'png')
        } catch (error) {
          console.warn('[Equation.3] Unable to rasterize preview image.', { sheetName, extension, error })
        }
      }
      if (!source) {
        console.warn('[Equation.3] Preview format is not renderable in this runtime.', { sheetName, extension })
        continue
      }
      drawings.push({ sheetName, source, ...geometry })
    }
  }
  return drawings
}

function isEquationEditorObject(programId: string | null): boolean {
  return !!programId && /(?:^|\.)Equation(?:\.3)?$/i.test(programId.trim())
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
  const entries = readZipEntries(bytes)
  return !entries || [...entries.keys()].some(isDrawingXmlPathText)
}

interface ZipEntry {
  compressionMethod: number
  compressedSize: number
  offset: number
  centralOffset: number
}

interface ZipReader {
  get(path: string): Uint8Array | undefined
}

class SelectiveZipReader implements ZipReader {
  private readonly cache = new Map<string, Uint8Array | undefined>()

  constructor(private readonly bytes: Uint8Array, private readonly entries: Map<string, ZipEntry>) {}

  get(path: string): Uint8Array | undefined {
    if (this.cache.has(path)) return this.cache.get(path)
    const entry = this.entries.get(path)
    const value = entry ? readZipEntry(this.bytes, entry) : undefined
    this.cache.set(path, value)
    return value
  }

}

class LegacyZipReader implements ZipReader {
  private readonly files: Record<string, Uint8Array>

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes)
  }

  get(path: string): Uint8Array | undefined {
    return this.files[path]
  }

}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> | null {
  const directory = centralDirectory(bytes)
  if (!directory) return null
  const entries = new Map<string, ZipEntry>()
  let offset = directory.offset
  const end = directory.offset + directory.size
  while (offset < end) {
    if (offset + 46 > bytes.length || readUint32(bytes, offset) !== 0x02014b50) return null
    const compressionMethod = readUint16(bytes, offset + 10)
    const compressedSize = readUint32(bytes, offset + 20)
    const nameLength = readUint16(bytes, offset + 28)
    const extraLength = readUint16(bytes, offset + 30)
    const commentLength = readUint16(bytes, offset + 32)
    const localHeaderOffset = readUint32(bytes, offset + 42)
    const nameStart = offset + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > bytes.length || next > end || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) return null
    entries.set(strFromU8(bytes.subarray(nameStart, nameStart + nameLength)), {
      compressionMethod,
      compressedSize,
      offset: localHeaderOffset,
      centralOffset: offset,
    })
    offset = next
  }
  return offset === end ? entries : null
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array | undefined {
  if (entry.offset + 30 > bytes.length || readUint32(bytes, entry.offset) !== 0x04034b50) return undefined
  const nameLength = readUint16(bytes, entry.offset + 26)
  const extraLength = readUint16(bytes, entry.offset + 28)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > bytes.length) return undefined
  const compressed = bytes.subarray(start, end)
  if (entry.compressionMethod === 0) return compressed.slice()
  if (entry.compressionMethod === 8) return inflateSync(compressed)
  return undefined
}

function centralDirectory(bytes: Uint8Array): { offset: number; size: number; endOffset: number } | null {
  // The end-of-central-directory comment is limited to 65535 bytes.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 0xffff - 22); offset -= 1) {
    if (readUint32(bytes, offset) !== 0x06054b50) continue
    const size = readUint32(bytes, offset + 12)
    const directoryOffset = readUint32(bytes, offset + 16)
    // ZIP64 stores sentinel values here. Fall back to the full parser there.
    if (size === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + size > bytes.length) return null
    return { offset: directoryOffset, size, endOffset: offset }
  }
  return null
}

/**
 * Produces an XLSX package that ExcelJS can load without image or drawing
 * parts. It copies compressed entries directly; no worksheet XML or cell data
 * is inflated just to disable image parsing for diagnostics.
 */
export function stripEmbeddedImagesFromXlsx(arrayBuffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(arrayBuffer)
  const directory = centralDirectory(bytes)
  const entries = readZipEntries(bytes)
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
  const newOffsets = new Map<ZipEntry, number>()
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
  return element.getAttribute('r:id') ?? element.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
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
    : ext ? { width: Number(ext.getAttribute('cx')) / EMUS_PER_PIXEL, height: Number(ext.getAttribute('cy')) / EMUS_PER_PIXEL }
      : null
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return null
  return { from: position, width: size.width, height: size.height }
}

function childByName(element: Element, localName: string): Element | null {
  return Array.from(element.children).find(child => child.localName === localName) ?? null
}

function anchorPosition(anchor: Element, worksheet: ExcelJS.Worksheet): OfficeMathDrawing['from'] | null {
  const column = Number(childByName(anchor, 'col')?.textContent)
  const row = Number(childByName(anchor, 'row')?.textContent)
  const columnOffset = Number(childByName(anchor, 'colOff')?.textContent) / EMUS_PER_PIXEL
  const rowOffset = Number(childByName(anchor, 'rowOff')?.textContent) / EMUS_PER_PIXEL
  if (![column, row, columnOffset, rowOffset].every(Number.isFinite)) return null
  return { column, columnOffset, row, rowOffset }
}

function anchorRangeSize(from: OfficeMathDrawing['from'], to: OfficeMathDrawing['from'] | null, worksheet: ExcelJS.Worksheet): { width: number; height: number } | null {
  if (!to) return null
  return {
    width: axisDistance(from.column, from.columnOffset, to.column, to.columnOffset, index => columnPixelWidth(worksheet, index)),
    height: axisDistance(from.row, from.rowOffset, to.row, to.rowOffset, index => rowPixelHeight(worksheet, index)),
  }
}

function axisDistance(start: number, startOffset: number, end: number, endOffset: number, sizeAt: (index: number) => number): number {
  if (end < start || (end === start && endOffset <= startOffset)) return 0
  let size = -startOffset + endOffset
  for (let index = start; index < end; index += 1) size += sizeAt(index)
  return size
}

function columnPixelWidth(worksheet: ExcelJS.Worksheet, index: number): number {
  return (worksheet.getColumn(index + 1).width ?? 8.43) * 8
}

function rowPixelHeight(worksheet: ExcelJS.Worksheet, index: number): number {
  return (worksheet.getRow(index + 1).height ?? 15) * 1.333
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
    case 'bar': return `<mover accent="true">${child('e')}<mo>¯</mo></mover>`
    case 'groupChr': return `<mover accent="true">${child('e')}<mo>⏞</mo></mover>`
    case 'acc': return `<mover accent="true">${child('e')}<mo>ˆ</mo></mover>`
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

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

async function mathMlToSvgDataUri(mathMl: string, width: number, height: number): Promise<string> {
  const mathJax = await loadMathJax()
  const host = document.createElement('div')
  host.innerHTML = mathMl
  await mathJax.typesetPromise([host])
  const svg = host.querySelector('svg')
  if (!svg) throw new Error('MathJax did not produce an SVG')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', `${width}px`)
  svg.setAttribute('height', `${height}px`)
  svg.setAttribute('preserveAspectRatio', 'xMinYMid meet')
  return `data:image/svg+xml;base64,${toBase64(svg.outerHTML)}`
}

async function loadMathJax(): Promise<MathJaxRuntime> {
  if (!mathJaxReady) {
    window.MathJax = { startup: { promise: Promise.resolve() }, typesetPromise: async () => {} }
    mathJaxReady = import('mathjax/mml-svg.js').then(async () => {
      const mathJax = window.MathJax
      if (!mathJax) throw new Error('MathJax did not initialize')
      await mathJax.startup.promise
      return mathJax
    })
  }
  return mathJaxReady
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
