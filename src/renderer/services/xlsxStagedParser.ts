import { strFromU8, strToU8, zipSync } from 'fflate'
import { convertXlsxToWorkbookData, type ConversionResult, type WorkbookConversionOptions } from './xlsx-converter'
import { formulaDependencyClosure, scanXlsxFormulaDependencies, type FormulaDependencyGraph } from './xlsxFormulaDependencies'
import { createXlsxZipReader, readXlsxZipEntries } from './xlsxZip'

export interface StagedWorkbookLoadPlan {
  mode: 'staged' | 'full'
  activeSheetName: string
  sheetNames: string[]
  fallbackReasons: string[]
  graph: FormulaDependencyGraph
}

export interface StagedWorkbookConversionResult {
  plan: StagedWorkbookLoadPlan
  conversion: ConversionResult
}

export type LatestStagedLoadResult<T> =
  | { status: 'current'; value: T }
  | { status: 'stale' }

interface WorkbookSheetPart {
  name: string
  relationshipId: string
  path: string
  index: number
}

/**
 * Determines the smallest safe worksheet set for a first-pass load. Opaque
 * formulas deliberately opt out: a complete workbook is preferable to a
 * superficially fast view with missing calculation inputs.
 */
export function planStagedWorkbookLoad(arrayBuffer: ArrayBuffer, activeSheetName: string): StagedWorkbookLoadPlan {
  const graph = scanXlsxFormulaDependencies(arrayBuffer)
  if (!graph.sheetNames.includes(activeSheetName)) throw new Error(`The worksheet "${activeSheetName}" is unavailable.`)

  const closure = formulaDependencyClosure(graph, activeSheetName)
  const fallbackReasons = [
    ...(readXlsxZipEntries(new Uint8Array(arrayBuffer)) ? [] : ['ZIP central directory is unavailable']),
    ...opaqueFormulaReasons(graph, closure),
  ]
  return {
    mode: fallbackReasons.length > 0 ? 'full' : 'staged',
    activeSheetName,
    sheetNames: fallbackReasons.length > 0 ? graph.sheetNames : closure,
    fallbackReasons,
    graph,
  }
}

/**
 * Materializes an XLSX package containing only planned worksheets and their
 * package dependencies. This is intentionally separate from UI loading so
 * equivalence can be proven before staged rendering is enabled.
 */
export function materializeStagedWorkbookPackage(arrayBuffer: ArrayBuffer, plan: StagedWorkbookLoadPlan): ArrayBuffer {
  if (plan.mode === 'full') return arrayBuffer.slice(0)
  if (typeof DOMParser === 'undefined') throw new Error('XML parsing is unavailable in this runtime.')

  const bytes = new Uint8Array(arrayBuffer)
  const entries = readXlsxZipEntries(bytes)
  const files = createXlsxZipReader(bytes, entries)
  const read = (path: string) => files.get(path)
  const readXml = (path: string): Document => {
    const source = read(path)
    if (!source) throw new Error(`The XLSX package part "${path}" is unavailable.`)
    const document = new DOMParser().parseFromString(strFromU8(source), 'application/xml')
    if (document.getElementsByTagName('parsererror').length > 0) throw new Error(`The XLSX package part "${path}" is invalid XML.`)
    return document
  }

  const workbook = readXml('xl/workbook.xml')
  const workbookRelationships = readXml('xl/_rels/workbook.xml.rels')
  const relationshipTargets = relationshipTargetMap(workbookRelationships, 'xl/workbook.xml')
  const sheets = workbookSheets(workbook, relationshipTargets)
  const selectedNames = new Set(plan.sheetNames)
  const selectedSheets = sheets.filter(sheet => selectedNames.has(sheet.name))
  if (selectedSheets.length !== plan.sheetNames.length) throw new Error('The staged worksheet plan no longer matches the XLSX package.')

  filterWorkbookDocument(workbook, selectedSheets, plan.activeSheetName)
  filterWorkbookRelationships(workbookRelationships, new Set(selectedSheets.map(sheet => sheet.relationshipId)))

  const output = new Map<string, Uint8Array>()
  const add = (path: string) => {
    if (output.has(path)) return
    const source = read(path)
    if (source) output.set(path, source)
  }
  const addPartTree = (path: string) => {
    if (output.has(path)) return
    add(path)
    const relationshipPath = relationshipPathFor(path)
    const relationshipBytes = read(relationshipPath)
    if (!relationshipBytes) return
    add(relationshipPath)
    const relationships = readXml(relationshipPath)
    for (const relationship of relationshipElements(relationships)) {
      const target = relationship.getAttribute('Target')
      if (target) addPartTree(resolvePackagePath(path, target))
    }
  }

  add('[Content_Types].xml')
  add('_rels/.rels')
  for (const path of entries?.keys() ?? []) {
    if (path.startsWith('docProps/')) add(path)
  }
  for (const relationship of relationshipElements(workbookRelationships)) {
    const target = relationship.getAttribute('Target')
    if (target) addPartTree(resolvePackagePath('xl/workbook.xml', target))
  }
  for (const sheet of selectedSheets) addPartTree(sheet.path)

  output.set('xl/workbook.xml', strToU8(serializeXml(workbook)))
  output.set('xl/_rels/workbook.xml.rels', strToU8(serializeXml(workbookRelationships)))
  const archive = zipSync(Object.fromEntries(output), { level: 6 })
  return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
}

export async function convertStagedXlsxToWorkbookData(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  activeSheetName: string,
  options: WorkbookConversionOptions = {},
): Promise<StagedWorkbookConversionResult> {
  const plan = planStagedWorkbookLoad(arrayBuffer, activeSheetName)
  const stagedPackage = materializeStagedWorkbookPackage(arrayBuffer, plan)
  return { plan, conversion: await convertXlsxToWorkbookData(stagedPackage, fileName, options) }
}

/**
 * Keeps background worksheet preparation from committing after a workbook or
 * sheet switch. It does not cancel parsing work, but makes the result safe to
 * discard at the UI boundary.
 */
export class LatestStagedLoadCoordinator {
  private generation = 0

  invalidate(): void {
    this.generation += 1
  }

  async run<T>(operation: () => Promise<T>): Promise<LatestStagedLoadResult<T>> {
    const generation = ++this.generation
    const value = await operation()
    return generation === this.generation ? { status: 'current', value } : { status: 'stale' }
  }
}

function opaqueFormulaReasons(graph: FormulaDependencyGraph, closure: string[]): string[] {
  const sets: Array<[string, string[]]> = [
    ['dynamic references', graph.dynamicReferenceSheets],
    ['external references', graph.externalReferenceSheets],
    ['unparseable formulas', graph.unparseableFormulaSheets],
    ['unresolved structured references', graph.unresolvedStructuredReferenceSheets],
  ]
  return sets.flatMap(([reason, sheetNames]) => sheetNames.filter(sheetName => closure.includes(sheetName)).map(sheetName => `${reason}: ${sheetName}`))
}

function workbookSheets(workbook: Document, targets: Map<string, string>): WorkbookSheetPart[] {
  return elementsByLocalName(workbook, 'sheet').map((sheet, index) => {
    const name = sheet.getAttribute('name')
    const relationshipId = relationshipIdFor(sheet)
    const path = relationshipId ? targets.get(relationshipId) : undefined
    if (!name || !relationshipId || !path) throw new Error('The XLSX workbook contains a sheet without a readable relationship.')
    return { name, relationshipId, path, index }
  })
}

function filterWorkbookDocument(workbook: Document, selectedSheets: WorkbookSheetPart[], activeSheetName: string): void {
  const selectedIds = new Set(selectedSheets.map(sheet => sheet.relationshipId))
  const originalToStagedIndex = new Map(selectedSheets.map((sheet, index) => [sheet.index, index]))
  for (const sheet of elementsByLocalName(workbook, 'sheet')) {
    if (!selectedIds.has(relationshipIdFor(sheet) ?? '')) sheet.parentNode?.removeChild(sheet)
  }
  for (const definedName of elementsByLocalName(workbook, 'definedName')) {
    const localSheetId = definedName.getAttribute('localSheetId')
    if (localSheetId === null) continue
    const stagedIndex = originalToStagedIndex.get(Number(localSheetId))
    if (stagedIndex === undefined) definedName.parentNode?.removeChild(definedName)
    else definedName.setAttribute('localSheetId', String(stagedIndex))
  }
  const activeIndex = selectedSheets.findIndex(sheet => sheet.name === activeSheetName)
  for (const view of elementsByLocalName(workbook, 'workbookView')) view.setAttribute('activeTab', String(Math.max(0, activeIndex)))
}

function filterWorkbookRelationships(relationships: Document, selectedRelationshipIds: Set<string>): void {
  for (const relationship of relationshipElements(relationships)) {
    const id = relationship.getAttribute('Id')
    const type = relationship.getAttribute('Type') ?? ''
    if (type.endsWith('/worksheet') && (!id || !selectedRelationshipIds.has(id))) relationship.parentNode?.removeChild(relationship)
  }
}

function relationshipTargetMap(relationships: Document, fromPath: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const relationship of relationshipElements(relationships)) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target) targets.set(id, resolvePackagePath(fromPath, target))
  }
  return targets
}

function relationshipElements(document: Document): Element[] {
  return elementsByLocalName(document, 'Relationship')
}

function elementsByLocalName(document: Document | Element, localName: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter(element => element.localName === localName || element.nodeName.split(':').pop() === localName)
}

function relationshipIdFor(element: Element): string | null {
  return element.getAttribute('r:id') ?? element.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
}

function relationshipPathFor(partPath: string): string {
  const parts = partPath.split('/')
  const fileName = parts.pop()
  return `${parts.join('/')}/_rels/${fileName}.rels`
}

function resolvePackagePath(fromPath: string, target: string): string {
  const segments = fromPath.split('/').slice(0, -1)
  for (const segment of target.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') { segments.pop(); continue }
    segments.push(segment)
  }
  return segments.join('/')
}

function serializeXml(document: Document): string {
  if (typeof XMLSerializer !== 'undefined') return new XMLSerializer().serializeToString(document)
  const fallback = document as unknown as { toString?: () => string }
  if (typeof fallback.toString === 'function') return fallback.toString()
  throw new Error('XML serialization is unavailable in this runtime.')
}
