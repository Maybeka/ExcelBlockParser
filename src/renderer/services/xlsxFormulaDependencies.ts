import { strFromU8 } from 'fflate'
import { LexerTreeBuilder } from '@univerjs/engine-formula'
import { createXlsxZipReader, readXlsxZipEntries } from './xlsxZip'

export interface FormulaDependencyGraph {
  sheetNames: string[]
  dependencies: Record<string, string[]>
  formulaCounts: Record<string, number>
  dynamicReferenceSheets: string[]
  externalReferenceSheets: string[]
  unparseableFormulaSheets: string[]
  unresolvedStructuredReferenceSheets: string[]
}

interface NamedFormula {
  formula: string
  scopeSheet: string | null
}

const externalReferencePattern = /\[[^\]]+\][^!\s]*!/i
const referencePrefixPattern = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))(?:\s*:\s*(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*)))?\s*!/g
const identifierPattern = /\b[A-Za-z_][A-Za-z0-9_.]*\b/g

/**
 * Reads only XLSX package metadata and formula nodes. This is intentionally
 * independent from the full ExcelJS conversion path until equivalence tests
 * establish that it is safe to use for staged workbook loading.
 */
export function scanXlsxFormulaDependencies(arrayBuffer: ArrayBuffer): FormulaDependencyGraph {
  if (typeof DOMParser === 'undefined') throw new Error('XML parsing is unavailable in this runtime.')
  const bytes = new Uint8Array(arrayBuffer)
  const entries = readXlsxZipEntries(bytes)
  const files = createXlsxZipReader(bytes, entries)
  const readXml = (path: string): Document | null => {
    const part = files.get(path)
    if (!part) return null
    const document = new DOMParser().parseFromString(strFromU8(part), 'application/xml')
    return document.getElementsByTagName('parsererror').length > 0 ? null : document
  }

  const workbook = readXml('xl/workbook.xml')
  const relationships = readXml('xl/_rels/workbook.xml.rels')
  if (!workbook || !relationships) throw new Error('The XLSX workbook metadata is unavailable.')

  const targets = new Map<string, string>()
  for (const relationship of elementsByLocalName(relationships, 'Relationship')) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target) targets.set(id, resolvePackagePath('xl/workbook.xml', target))
  }

  const sheets = elementsByLocalName(workbook, 'sheet').map((sheet, index) => {
    const name = sheet.getAttribute('name')
    const relationshipId = relationshipIdFor(sheet)
    const path = relationshipId ? targets.get(relationshipId) : undefined
    if (!name || !path) throw new Error('The XLSX workbook contains a sheet without a readable relationship.')
    return { name, path, index }
  })
  const sheetNames = sheets.map(sheet => sheet.name)
  const sheetNameByLowerCase = new Map(sheetNames.map(name => [name.toLocaleLowerCase(), name]))
  const tableOwnerByLowerCase = readTableOwners(sheets, readXml)
  const namedFormulas = readNamedFormulas(workbook, sheetNames)
  const dependencies = Object.fromEntries(sheetNames.map(name => [name, [] as string[]])) as Record<string, string[]>
  const formulaCounts = Object.fromEntries(sheetNames.map(name => [name, 0])) as Record<string, number>
  const dynamicReferenceSheets = new Set<string>()
  const externalReferenceSheets = new Set<string>()
  const unparseableFormulaSheets = new Set<string>()
  const unresolvedStructuredReferenceSheets = new Set<string>()

  const resolveNamedFormula = (name: string, sourceSheet: string, visited: Set<string>): string[] => {
    const lowerName = name.toLocaleLowerCase()
    const named = namedFormulas.get(`${sourceSheet}\u0000${lowerName}`) ?? namedFormulas.get(`\u0000${lowerName}`)
    if (!named) return []
    const key = `${named.scopeSheet ?? ''}\u0000${lowerName}`
    if (visited.has(key)) return []
    visited.add(key)
    return formulaDependencies(named.formula, sourceSheet, sheetNames, sheetNameByLowerCase, tableOwnerByLowerCase, namedFormulas, resolveNamedFormula, visited).dependencies
  }

  for (const sheet of sheets) {
    const document = readXml(sheet.path)
    if (!document) throw new Error(`The XLSX worksheet "${sheet.name}" is unavailable.`)
    const referenced = new Set<string>()
    const sharedFormulaText = new Map<string, string>()
    for (const formula of elementsByLocalName(document, 'f')) {
      formulaCounts[sheet.name] += 1
      const sharedIndex = formula.getAttribute('t') === 'shared' ? formula.getAttribute('si') : null
      const rawFormulaText = formula.textContent ?? ''
      if (sharedIndex && rawFormulaText) sharedFormulaText.set(sharedIndex, rawFormulaText)
      const formulaText = rawFormulaText || (sharedIndex ? sharedFormulaText.get(sharedIndex) ?? '' : '')
      const syntax = inspectFormulaSyntax(formulaText)
      if (!syntax.valid) {
        unparseableFormulaSheets.add(sheet.name)
        continue
      }
      const analysis = formulaDependencies(
        formulaText, sheet.name, sheetNames, sheetNameByLowerCase, tableOwnerByLowerCase, namedFormulas, resolveNamedFormula, new Set(), syntax.dynamic,
      )
      for (const dependency of analysis.dependencies) if (dependency !== sheet.name) referenced.add(dependency)
      if (analysis.dynamic) dynamicReferenceSheets.add(sheet.name)
      if (analysis.external) externalReferenceSheets.add(sheet.name)
      if (analysis.unresolvedStructuredReference) unresolvedStructuredReferenceSheets.add(sheet.name)
    }
    dependencies[sheet.name] = [...referenced].sort((a, b) => sheetNames.indexOf(a) - sheetNames.indexOf(b))
  }

  return {
    sheetNames,
    dependencies,
    formulaCounts,
    dynamicReferenceSheets: [...dynamicReferenceSheets].sort((a, b) => sheetNames.indexOf(a) - sheetNames.indexOf(b)),
    externalReferenceSheets: [...externalReferenceSheets].sort((a, b) => sheetNames.indexOf(a) - sheetNames.indexOf(b)),
    unparseableFormulaSheets: [...unparseableFormulaSheets].sort((a, b) => sheetNames.indexOf(a) - sheetNames.indexOf(b)),
    unresolvedStructuredReferenceSheets: [...unresolvedStructuredReferenceSheets].sort((a, b) => sheetNames.indexOf(a) - sheetNames.indexOf(b)),
  }
}

export function formulaDependencyClosure(graph: FormulaDependencyGraph, sheetName: string): string[] {
  if (!graph.sheetNames.includes(sheetName)) return []
  const visited = new Set<string>()
  const visit = (name: string) => {
    if (visited.has(name)) return
    visited.add(name)
    for (const dependency of graph.dependencies[name] ?? []) visit(dependency)
  }
  visit(sheetName)
  return graph.sheetNames.filter(name => visited.has(name))
}

function formulaDependencies(
  formula: string,
  sourceSheet: string,
  sheetNames: string[],
  sheetNameByLowerCase: Map<string, string>,
  tableOwnerByLowerCase: Map<string, string>,
  namedFormulas: Map<string, NamedFormula>,
  resolveNamedFormula: (name: string, sourceSheet: string, visited: Set<string>) => string[],
  visitedNames: Set<string>,
  dynamic: boolean = false,
): { dependencies: string[]; dynamic: boolean; external: boolean; unresolvedStructuredReference: boolean } {
  const withoutStrings = removeStringLiterals(formula)
  const dependencies = new Set<string>()
  let remaining = withoutStrings
  for (const match of withoutStrings.matchAll(referencePrefixPattern)) {
    const first = unescapeSheetName(match[1] ?? match[2] ?? '')
    const second = unescapeSheetName(match[3] ?? match[4] ?? '')
    addSheetOrThreeDimensionalRange(first, second || null, sheetNames, sheetNameByLowerCase, dependencies)
    const start = match.index ?? 0
    remaining = `${remaining.slice(0, start)}${' '.repeat(match[0].length)}${remaining.slice(start + match[0].length)}`
  }

  for (const identifier of remaining.matchAll(identifierPattern)) {
    const name = identifier[0]
    const lowerName = name.toLocaleLowerCase()
    if (!namedFormulas.has(`${sourceSheet}\u0000${lowerName}`) && !namedFormulas.has(`\u0000${lowerName}`)) continue
    for (const dependency of resolveNamedFormula(name, sourceSheet, visitedNames)) dependencies.add(dependency)
  }
  let unresolvedStructuredReference = false
  for (const match of remaining.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\[/g)) {
    const tableName = match[1]!
    const owner = tableOwnerByLowerCase.get(tableName.toLocaleLowerCase())
    if (owner) dependencies.add(owner)
    else unresolvedStructuredReference = true
  }

  return {
    dependencies: [...dependencies],
    dynamic,
    external: externalReferencePattern.test(withoutStrings),
    unresolvedStructuredReference,
  }
}

function readTableOwners(
  sheets: Array<{ name: string; path: string }>,
  readXml: (path: string) => Document | null,
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const sheet of sheets) {
    const relationships = readXml(relationshipPathFor(sheet.path))
    if (!relationships) continue
    for (const relationship of elementsByLocalName(relationships, 'Relationship')) {
      const type = relationship.getAttribute('Type') ?? ''
      const target = relationship.getAttribute('Target')
      if (!type.endsWith('/table') || !target) continue
      const table = readXml(resolvePackagePath(sheet.path, target))
      const root = table?.documentElement
      const tableName = root?.getAttribute('displayName') ?? root?.getAttribute('name')
      if (tableName) owners.set(tableName.toLocaleLowerCase(), sheet.name)
    }
  }
  return owners
}

function inspectFormulaSyntax(formula: string): { valid: boolean; dynamic: boolean } {
  const lexer = new LexerTreeBuilder()
  try {
    const root = lexer.treeBuilder(formula.startsWith('=') ? formula : `=${formula}`)
    if (!root || typeof root === 'string') return { valid: false, dynamic: false }
    return { valid: true, dynamic: containsDynamicReferenceFunction(root) }
  } finally {
    lexer.dispose()
  }
}

function containsDynamicReferenceFunction(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDynamicReferenceFunction)
  if (!value || typeof value !== 'object' || !('getToken' in value) || !('getChildren' in value)) return false
  const node = value as { getToken: () => string; getChildren: () => unknown[] }
  return ['INDIRECT', 'OFFSET'].includes(node.getToken().toLocaleUpperCase()) || node.getChildren().some(containsDynamicReferenceFunction)
}

function readNamedFormulas(workbook: Document, sheetNames: string[]): Map<string, NamedFormula> {
  const named = new Map<string, NamedFormula>()
  for (const element of elementsByLocalName(workbook, 'definedName')) {
    const name = element.getAttribute('name')
    if (!name) continue
    const localSheetId = element.getAttribute('localSheetId')
    const scopeSheet = localSheetId === null ? null : sheetNames[Number(localSheetId)] ?? null
    named.set(`${scopeSheet ?? ''}\u0000${name.toLocaleLowerCase()}`, { formula: element.textContent ?? '', scopeSheet })
  }
  return named
}

function addSheetOrThreeDimensionalRange(
  first: string,
  second: string | null,
  sheetNames: string[],
  sheetNameByLowerCase: Map<string, string>,
  target: Set<string>,
): void {
  const firstName = sheetNameByLowerCase.get(first.toLocaleLowerCase())
  const secondName = second ? sheetNameByLowerCase.get(second.toLocaleLowerCase()) : null
  if (!firstName) return
  if (!second) { target.add(firstName); return }
  if (!secondName) return
  const firstIndex = sheetNames.indexOf(firstName)
  const secondIndex = sheetNames.indexOf(secondName)
  for (const sheetName of sheetNames.slice(Math.min(firstIndex, secondIndex), Math.max(firstIndex, secondIndex) + 1)) target.add(sheetName)
}

function removeStringLiterals(formula: string): string {
  return formula.replace(/"(?:[^"]|"")*"/g, match => ' '.repeat(match.length))
}

function unescapeSheetName(value: string): string {
  return value.replace(/''/g, "'")
}

function elementsByLocalName(document: Document | Element, localName: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter(element => element.localName === localName || element.nodeName.split(':').pop() === localName)
}

function relationshipIdFor(element: Element): string | null {
  return element.getAttribute('r:id') ?? element.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
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

function relationshipPathFor(partPath: string): string {
  const parts = partPath.split('/')
  const fileName = parts.pop()
  return `${parts.join('/')}/_rels/${fileName}.rels`
}
