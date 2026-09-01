import { MAX_ROW_FILTER_DEPTH } from './rowFilter'
import { MAX_PYTHON_FILE_BYTES, MAX_PYTHON_PROJECT_BYTES, normalizePythonPath } from './pythonPackage'

type RecordValue = Record<string, unknown>

const blockKeys = new Set([
  'id', 'label', 'workbookId', 'range', 'activeSheet', 'headerRows', 'collapsed',
  'selectionLocked', 'columns', 'dataSnapshot', 'headerSnapshot', 'rowFilter',
  'skipEmptyColumns', 'tags', 'computedProperties',
])
const columnKeys = new Set(['colIndex', 'colLetter', 'suggestedKey', 'key', 'type', 'skip', 'valueMap', 'valueMapFallbackType'])
const columnTypes = new Set(['auto', 'string', 'integer', 'float', 'boolean', 'date', 'valueMapping'])
const fallbackTypes = new Set(['auto', 'string', 'integer', 'float', 'boolean', 'date'])
const rowFilterOperators = new Set(['eq', 'neq', 'in', 'notIn', 'contains', 'notContains', 'empty', 'notEmpty', 'regex', 'notRegex'])
const splitTypes = new Set(['keyword', 'emptyRow', 'emptyColumn'])

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKey(value: RecordValue, allowed: Set<string>): string | null {
  return Object.keys(value).find(key => !allowed.has(key)) ?? null
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function validateRange(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (unknownKey(value, new Set(['startRow', 'startCol', 'endRow', 'endCol', 'a1Notation']))) return false
  const { startRow, startCol, endRow, endCol, a1Notation } = value
  return Number.isInteger(startRow) && Number.isInteger(startCol)
    && Number.isInteger(endRow) && Number.isInteger(endCol)
    && Number(startRow) >= 0 && Number(startCol) >= 0
    && Number(endRow) >= Number(startRow) && Number(endCol) >= Number(startCol)
    && typeof a1Notation === 'string' && a1Notation.length > 0
}

function validateTag(value: unknown): boolean {
  return isRecord(value)
    && !unknownKey(value, new Set(['type', 'key', 'value']))
    && (value.type === 'label' || value.type === 'kv')
    && typeof value.key === 'string' && value.key.length > 0
    && (value.value === undefined || typeof value.value === 'string')
}

function validateColumn(value: unknown): boolean {
  if (!isRecord(value) || unknownKey(value, columnKeys)) return false
  if (!Number.isInteger(value.colIndex) || Number(value.colIndex) < 0 || typeof value.colLetter !== 'string' || !value.colLetter) return false
  if (typeof value.suggestedKey !== 'string' || typeof value.key !== 'string' || !columnTypes.has(String(value.type))) return false
  if (typeof value.skip !== 'boolean' || !Array.isArray(value.valueMap)) return false
  if (value.valueMapFallbackType !== undefined && !fallbackTypes.has(String(value.valueMapFallbackType))) return false
  return value.valueMap.every(entry => isRecord(entry)
    && !unknownKey(entry, new Set(['from', 'to']))
    && typeof entry.from === 'string'
    && Object.prototype.hasOwnProperty.call(entry, 'to')
    && isJsonValue(entry.to))
}

function validateRowFilterCondition(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > MAX_ROW_FILTER_DEPTH) return false
  if (value.type === 'all' || value.type === 'any') {
    return !unknownKey(value, new Set(['type', 'conditions']))
      && Array.isArray(value.conditions)
      && value.conditions.length > 0
      && value.conditions.length <= 100
      && value.conditions.every(condition => validateRowFilterCondition(condition, depth + 1))
  }
  if (value.type !== 'rule' || unknownKey(value, new Set(['type', 'column', 'operator', 'value', 'values']))) return false
  if (typeof value.column !== 'string' || !value.column || !rowFilterOperators.has(String(value.operator))) return false
  if (value.value !== undefined && typeof value.value !== 'string') return false
  if (value.values !== undefined && (!Array.isArray(value.values) || value.values.some(item => typeof item !== 'string' || item.length === 0))) return false
  const needsValues = value.operator === 'in' || value.operator === 'notIn'
  const noValue = value.operator === 'empty' || value.operator === 'notEmpty'
  if (needsValues) return Array.isArray(value.values) && value.values.length > 0 && value.value === undefined
  if (noValue) return value.value === undefined && value.values === undefined
  return typeof value.value === 'string' && value.value.length > 0 && value.values === undefined
}

function validateRowFilter(value: unknown): boolean {
  if (!isRecord(value) || unknownKey(value, new Set(['removeEmptyRows', 'emptyCellConditions', 'matchMode', 'condition']))) return false
  if (typeof value.removeEmptyRows !== 'boolean' || !isRecord(value.emptyCellConditions)) return false
  if (unknownKey(value.emptyCellConditions, new Set(['fullyStruck'])) || typeof value.emptyCellConditions.fullyStruck !== 'boolean') return false
  if (value.matchMode !== undefined && value.matchMode !== 'include' && value.matchMode !== 'exclude') return false
  return value.condition === null || validateRowFilterCondition(value.condition)
}

export function validateProjectBlock(value: unknown, index: number, nested = false): string | null {
  if (!isRecord(value)) return `Invalid block at index ${index}: expected an object.`
  const extra = unknownKey(value, blockKeys)
  if (extra) return `Invalid block at index ${index}: unknown field "${extra}".`
  if (typeof value.id !== 'string' || !value.id || typeof value.label !== 'string') return `Invalid block at index ${index}: id and label are invalid.`
  if (!nested && (typeof value.workbookId !== 'string' || !value.workbookId)) return `Invalid project file: item "${value.label}" has no workbook mapping.`
  if (nested && value.workbookId !== undefined && value.workbookId !== null && typeof value.workbookId !== 'string') return `Invalid block "${value.label}": workbookId is invalid.`
  if (!Object.prototype.hasOwnProperty.call(value, 'range') || (value.range !== null && !validateRange(value.range))) return `Invalid block "${value.label}": range is invalid.`
  if (!Object.prototype.hasOwnProperty.call(value, 'activeSheet') || (value.activeSheet !== null && typeof value.activeSheet !== 'string')) return `Invalid block "${value.label}": activeSheet is invalid.`
  if (!Array.isArray(value.headerRows) || value.headerRows.some(row => !Number.isInteger(row) || Number(row) < 0) || new Set(value.headerRows).size !== value.headerRows.length) return `Invalid block "${value.label}": headerRows are invalid.`
  if (typeof value.collapsed !== 'boolean' || typeof value.selectionLocked !== 'boolean') return `Invalid block "${value.label}": display state is invalid.`
  if (!Array.isArray(value.columns) || !value.columns.every(validateColumn)) return `Invalid block "${value.label}": columns are invalid.`
  if (!Object.prototype.hasOwnProperty.call(value, 'dataSnapshot') || (value.dataSnapshot !== null && (!Array.isArray(value.dataSnapshot) || value.dataSnapshot.some(row => !Array.isArray(row) || !row.every(isJsonValue))))) return `Invalid block "${value.label}": dataSnapshot is invalid.`
  if (value.headerSnapshot !== undefined) {
    if (!Array.isArray(value.headerSnapshot)) return `Invalid block "${value.label}": headerSnapshot is invalid.`
    const flat = value.headerSnapshot.every(item => typeof item === 'string')
    const matrix = value.headerSnapshot.every(row => Array.isArray(row) && row.every(item => typeof item === 'string'))
    if (!flat && !matrix) return `Invalid block "${value.label}": headerSnapshot is invalid.`
  }
  if (value.rowFilter !== undefined && !validateRowFilter(value.rowFilter)) return `Invalid block "${value.label}": rowFilter is invalid.`
  if (value.skipEmptyColumns !== undefined && typeof value.skipEmptyColumns !== 'boolean') return `Invalid block "${value.label}": skipEmptyColumns is invalid.`
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(validateTag))) return `Invalid block "${value.label}": tags are invalid.`
  if (value.computedProperties !== undefined && (!Array.isArray(value.computedProperties) || value.computedProperties.some(item => !isRecord(item)
    || Boolean(unknownKey(item, new Set(['id', 'label', 'expression'])))
    || typeof item.id !== 'string' || !item.id || typeof item.label !== 'string' || typeof item.expression !== 'string'))) return `Invalid block "${value.label}": computedProperties are invalid.`
  return null
}

function validateRegion(value: unknown, index: number): string | null {
  if (!isRecord(value)) return `Invalid region at index ${index}: expected an object.`
  const extra = unknownKey(value, new Set(['id', 'label', 'workbookId', 'range', 'activeSheet', 'splitRules', 'blocks', 'collapsed', 'selectionLocked', 'tags']))
  if (extra) return `Invalid region at index ${index}: unknown field "${extra}".`
  if (typeof value.id !== 'string' || !value.id || typeof value.label !== 'string' || typeof value.workbookId !== 'string' || !value.workbookId) return `Invalid region at index ${index}: identity is invalid.`
  if (!Object.prototype.hasOwnProperty.call(value, 'range') || (value.range !== null && !validateRange(value.range))) return `Invalid region "${value.label}": range is invalid.`
  if (!Object.prototype.hasOwnProperty.call(value, 'activeSheet') || (value.activeSheet !== null && typeof value.activeSheet !== 'string')) return `Invalid region "${value.label}": activeSheet is invalid.`
  if (!Array.isArray(value.splitRules) || value.splitRules.some(rule => !isRecord(rule)
    || Boolean(unknownKey(rule, new Set(['type', 'keyword', 'minGap'])))
    || !splitTypes.has(String(rule.type))
    || (rule.keyword !== undefined && typeof rule.keyword !== 'string')
    || (rule.minGap !== undefined && (!Number.isInteger(rule.minGap) || Number(rule.minGap) < 1)))) return `Invalid region "${value.label}": splitRules are invalid.`
  if (!Array.isArray(value.blocks)) return `Invalid region "${value.label}": blocks are invalid.`
  for (let blockIndex = 0; blockIndex < value.blocks.length; blockIndex++) {
    const error = validateProjectBlock(value.blocks[blockIndex], blockIndex, true)
    if (error) return `Invalid region "${value.label}": ${error}`
  }
  if (typeof value.collapsed !== 'boolean' || typeof value.selectionLocked !== 'boolean') return `Invalid region "${value.label}": display state is invalid.`
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(validateTag))) return `Invalid region "${value.label}": tags are invalid.`
  return null
}

function validateWorkbook(value: unknown, index: number): string | null {
  if (!isRecord(value)) return `Invalid project workbook at index ${index}.`
  const extra = unknownKey(value, new Set(['id', 'name', 'sourcePath', 'sheetNames', 'sheetTabColors', 'activeSheetName']))
  if (extra) return `Invalid project workbook at index ${index}: unknown field "${extra}".`
  if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name) return `Invalid project workbook at index ${index}.`
  if (value.sourcePath !== undefined && (typeof value.sourcePath !== 'string' || !value.sourcePath)) return `Invalid project workbook at index ${index}: sourcePath is invalid.`
  if (value.sheetNames !== undefined && (!Array.isArray(value.sheetNames) || value.sheetNames.some(name => typeof name !== 'string') || new Set(value.sheetNames).size !== value.sheetNames.length)) return `Invalid project workbook at index ${index}: sheetNames are invalid.`
  if (value.sheetTabColors !== undefined && (!isRecord(value.sheetTabColors) || Object.entries(value.sheetTabColors).some(([sheet, color]) => typeof sheet !== 'string' || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))) return `Invalid project workbook at index ${index}: sheetTabColors are invalid.`
  if (value.activeSheetName !== undefined && value.activeSheetName !== null && typeof value.activeSheetName !== 'string') return `Invalid project workbook at index ${index}: activeSheetName is invalid.`
  return null
}

function validateBlockResult(value: unknown, index: number): string | null {
  if (!isRecord(value) || unknownKey(value, new Set(['blockId', 'label', 'workbookId', 'data', 'rowCount']))) return `Invalid block result at index ${index}.`
  if (typeof value.blockId !== 'string' || !value.blockId || typeof value.label !== 'string' || typeof value.workbookId !== 'string' || !value.workbookId) return `Invalid block result at index ${index}: identity is invalid.`
  if (!Array.isArray(value.data) || value.data.some(row => !isRecord(row) || !isJsonValue(row))) return `Invalid block result at index ${index}: data is invalid.`
  if (!Number.isInteger(value.rowCount) || Number(value.rowCount) < 0 || value.rowCount !== value.data.length) return `Invalid block result at index ${index}: rowCount is invalid.`
  return null
}

function validateRegionResult(value: unknown, index: number): string | null {
  if (!isRecord(value) || unknownKey(value, new Set(['regionId', 'label', 'workbookId', 'blocks']))) return `Invalid region result at index ${index}.`
  if (typeof value.regionId !== 'string' || !value.regionId || typeof value.label !== 'string' || typeof value.workbookId !== 'string' || !value.workbookId || !Array.isArray(value.blocks)) return `Invalid region result at index ${index}: identity is invalid.`
  if (value.blocks.some(block => !isRecord(block)
    || Boolean(unknownKey(block, new Set(['blockLabel', 'rows', 'range'])))
    || typeof block.blockLabel !== 'string'
    || (block.range !== undefined && !validateRange(block.range))
    || !Array.isArray(block.rows)
    || block.rows.some(row => !Array.isArray(row) || row.some(cell => typeof cell !== 'string')))) return `Invalid region result at index ${index}: blocks are invalid.`
  return null
}

export function validateProjectV3Document(value: unknown): string[] {
  if (!isRecord(value)) return ['Invalid project file: expected a JSON object.']
  if (value.version !== 3) return ['Invalid project file: unsupported project version.']
  const documentErrors: string[] = []
  const topExtra = unknownKey(value, new Set(['version', 'exportedAt', 'project', 'data', 'blockResults', 'regionResults']))
  if (topExtra) return [`Invalid project file: unknown top-level field "${topExtra}".`]
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt)) || new Date(value.exportedAt).toISOString() !== value.exportedAt) documentErrors.push('Invalid project file: exportedAt must be an ISO date-time.')
  if (!isRecord(value.project)) return ['Invalid project file: missing project object.']
  const project = value.project
  const projectExtra = unknownKey(project, new Set(['id', 'name', 'workbooks', 'activeWorkbookId', 'blocks', 'regions', 'activeBlockId', 'activeRegionId', 'focusMode', 'pythonScript']))
  if (projectExtra) return [`Invalid project file: unknown project field "${projectExtra}".`]
  if (typeof project.id !== 'string' || !project.id || typeof project.name !== 'string' || !project.name
    || !Array.isArray(project.workbooks) || !Array.isArray(project.blocks) || !Array.isArray(project.regions)
    || (project.activeWorkbookId !== null && typeof project.activeWorkbookId !== 'string')
    || typeof project.activeBlockId !== 'string'
    || (project.activeRegionId !== null && typeof project.activeRegionId !== 'string')
    || (project.focusMode !== 'always-editable' && project.focusMode !== 'activate-first')) return ['Invalid project file: project fields are incomplete or invalid.']
  if (project.pythonScript !== undefined) {
    if (!isRecord(project.pythonScript)
      || Boolean(unknownKey(project.pythonScript, new Set(['entryPath', 'files'])))
      || typeof project.pythonScript.entryPath !== 'string'
      || !Array.isArray(project.pythonScript.files)) return ['Invalid project file: Python package is invalid.']
    const entryPath = normalizePythonPath(project.pythonScript.entryPath)
    const names = new Set<string>()
    let totalBytes = 0
    for (const file of project.pythonScript.files) {
      if (!isRecord(file) || Boolean(unknownKey(file, new Set(['path', 'source']))) || typeof file.path !== 'string' || typeof file.source !== 'string') return ['Invalid project file: Python package is invalid.']
      const path = normalizePythonPath(file.path)
      if (!path || names.has(path.toLocaleLowerCase('en-US'))) return ['Invalid project file: Python package is invalid.']
      names.add(path.toLocaleLowerCase('en-US'))
      const bytes = new TextEncoder().encode(file.source).byteLength
      if (bytes > MAX_PYTHON_FILE_BYTES) return ['Invalid project file: Python package is invalid.']
      totalBytes += bytes
    }
    if (!entryPath || !names.has(entryPath.toLocaleLowerCase('en-US')) || totalBytes > MAX_PYTHON_PROJECT_BYTES) return ['Invalid project file: Python package is invalid.']
  }
  if (!isRecord(value.data) || !isJsonValue(value.data) || !Array.isArray(value.blockResults)
    || (value.regionResults !== undefined && !Array.isArray(value.regionResults))) return ['Invalid project file: result fields are invalid.']

  const structuralErrors = project.workbooks.map(validateWorkbook).filter((error): error is string => Boolean(error))
  structuralErrors.push(...project.blocks.map((block, index) => validateProjectBlock(block, index)).filter((error): error is string => Boolean(error)))
  structuralErrors.push(...project.regions.map(validateRegion).filter((error): error is string => Boolean(error)))
  structuralErrors.push(...value.blockResults.map(validateBlockResult).filter((error): error is string => Boolean(error)))
  if (Array.isArray(value.regionResults)) structuralErrors.push(...value.regionResults.map(validateRegionResult).filter((error): error is string => Boolean(error)))
  if (structuralErrors.length) return [...documentErrors, ...structuralErrors]
  const errors = [...documentErrors]

  const workbookIds = (project.workbooks as RecordValue[]).map(workbook => String(workbook.id))
  const workbookIdSet = new Set(workbookIds)
  if (workbookIdSet.size !== workbookIds.length) errors.push('Invalid project file: duplicate workbook IDs.')
  const blocks = project.blocks as RecordValue[]
  const regions = project.regions as RecordValue[]
  const blockIds = blocks.map(block => String(block.id))
  const regionIds = regions.map(region => String(region.id))
  if (new Set(blockIds).size !== blockIds.length) errors.push('Invalid project file: duplicate block IDs.')
  if (new Set(regionIds).size !== regionIds.length) errors.push('Invalid project file: duplicate region IDs.')
  if (project.activeWorkbookId !== null && !workbookIdSet.has(project.activeWorkbookId as string)) errors.push('Invalid project file: active workbook is unavailable.')
  for (const item of [...blocks, ...regions]) {
    if (!workbookIdSet.has(String(item.workbookId))) errors.push(`Invalid project file: item references unavailable workbook "${item.workbookId}".`)
  }
  const activeBlock = blocks.find(block => block.id === project.activeBlockId)
  const activeRegion = regions.find(region => region.id === project.activeRegionId)
  if (project.activeBlockId && (!activeBlock || activeBlock.workbookId !== project.activeWorkbookId)) errors.push('Invalid project file: active block does not belong to the active workbook.')
  if (project.activeRegionId && (!activeRegion || activeRegion.workbookId !== project.activeWorkbookId)) errors.push('Invalid project file: active region does not belong to the active workbook.')
  for (const result of value.blockResults as RecordValue[]) {
    const owner = blocks.find(block => block.id === result.blockId)
    if (!owner || owner.workbookId !== result.workbookId) errors.push(`Invalid project file: block result "${result.blockId}" has invalid ownership.`)
  }
  for (const result of (value.regionResults ?? []) as RecordValue[]) {
    const owner = regions.find(region => region.id === result.regionId)
    if (!owner || owner.workbookId !== result.workbookId) errors.push(`Invalid project file: region result "${result.regionId}" has invalid ownership.`)
  }
  for (const workbookId of Object.keys(value.data)) {
    if (!workbookIdSet.has(workbookId)) errors.push(`Invalid project file: data references unavailable workbook "${workbookId}".`)
  }
  return errors
}
