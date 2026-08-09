import type { BlockConfig, ExportedProject, ExportedSession, ParseResult, ProjectConfig, ProjectWorkbook, RegionConfig, RegionParseResult, SessionConfig } from '../types'
import { LEGACY_WORKBOOK_ID } from './project'

export interface DeserializedSession {
  blocks: BlockConfig[]
  regions: RegionConfig[]
  activeBlockId: string
  focusMode: 'always-editable' | 'activate-first'
  parseResult: ParseResult | null
}

export interface SessionLoadResult {
  session?: DeserializedSession
  errors: string[]
  migratedFrom?: 1
}

export const CURRENT_SESSION_VERSION = 2 as const
export const CURRENT_PROJECT_VERSION = 3 as const

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const columnTypes = new Set(['auto', 'string', 'integer', 'float', 'boolean', 'date', 'valueMapping'])

function isValidRange(value: unknown): boolean {
  if (!isRecord(value)) return false
  const { startRow, startCol, endRow, endCol, a1Notation } = value
  return typeof startRow === 'number'
    && typeof startCol === 'number'
    && typeof endRow === 'number'
    && typeof endCol === 'number'
    && Number.isInteger(startRow)
    && Number.isInteger(startCol)
    && Number.isInteger(endRow)
    && Number.isInteger(endCol)
    && startRow >= 0
    && startCol >= 0
    && endRow >= startRow
    && endCol >= startCol
    && typeof a1Notation === 'string'
    && a1Notation.length > 0
}

function isMatrix(value: unknown): boolean {
  return Array.isArray(value) && value.every(Array.isArray)
}

function validateColumn(value: unknown, blockLabel: string, index: number): string | null {
  if (!isRecord(value)) return `Invalid block "${blockLabel}": column ${index} must be an object.`
  if (typeof value.colIndex !== 'number' || !Number.isInteger(value.colIndex) || value.colIndex < 0 || typeof value.colLetter !== 'string') {
    return `Invalid block "${blockLabel}": column ${index} has an invalid position.`
  }
  if (typeof value.suggestedKey !== 'string' || typeof value.key !== 'string' || !columnTypes.has(String(value.type))) {
    return `Invalid block "${blockLabel}": column ${index} has an invalid mapping.`
  }
  if (typeof value.skip !== 'boolean' || !Array.isArray(value.valueMap)) {
    return `Invalid block "${blockLabel}": column ${index} has an invalid skip or value map.`
  }
  if (value.valueMap.some(entry => !isRecord(entry) || typeof entry.from !== 'string')) {
    return `Invalid block "${blockLabel}": column ${index} has an invalid value map entry.`
  }
  return null
}

function validateBlock(value: unknown, index: number): string | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return `Invalid block at index ${index}: id and label must be strings.`
  if (!Array.isArray(value.columns) || !Array.isArray(value.headerRows)) return `Invalid block "${value.label}": columns and headerRows must be arrays.`
  if (value.range !== undefined && value.range !== null && !isValidRange(value.range)) return `Invalid block "${value.label}": range must be null or a valid cell range.`
  if (value.activeSheet !== undefined && value.activeSheet !== null && typeof value.activeSheet !== 'string') return `Invalid block "${value.label}": activeSheet must be a string or null.`
  if (value.headerRows.some(row => !Number.isInteger(row) || row < 0)) return `Invalid block "${value.label}": headerRows must contain non-negative integers.`
  if (value.dataSnapshot !== undefined && value.dataSnapshot !== null && !isMatrix(value.dataSnapshot)) return `Invalid block "${value.label}": dataSnapshot must be a matrix or null.`
  if (value.headerSnapshot !== undefined && !Array.isArray(value.headerSnapshot)) return `Invalid block "${value.label}": headerSnapshot must be an array.`
  for (let columnIndex = 0; columnIndex < value.columns.length; columnIndex++) {
    const error = validateColumn(value.columns[columnIndex], value.label, columnIndex)
    if (error) return error
  }
  return null
}

function validateRegion(value: unknown, index: number): string | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return `Invalid region at index ${index}: id and label must be strings.`
  if (value.range !== undefined && value.range !== null && !isValidRange(value.range)) return `Invalid region "${value.label}": range must be null or a valid cell range.`
  if (!Array.isArray(value.splitRules) || !Array.isArray(value.blocks)) return `Invalid region "${value.label}": splitRules and blocks must be arrays.`
  if (value.splitRules.some(rule => !isRecord(rule) || !['keyword', 'emptyRow', 'emptyColumn'].includes(String(rule.type)))) {
    return `Invalid region "${value.label}": splitRules contain an unsupported rule.`
  }
  for (let blockIndex = 0; blockIndex < value.blocks.length; blockIndex++) {
    const error = validateBlock(value.blocks[blockIndex], blockIndex)
    if (error) return `Invalid region "${value.label}": ${error}`
  }
  return null
}

export function serializeSession(
  blocks: BlockConfig[],
  regions: RegionConfig[],
  activeBlockId: string,
  focusMode: 'always-editable' | 'activate-first',
  parseResult: ParseResult | null,
): ExportedSession {
  const config: SessionConfig = {
    blocks,
    activeBlockId,
    focusMode,
    regions,
  }

  const session: ExportedSession = {
    version: CURRENT_SESSION_VERSION,
    exportedAt: new Date().toISOString(),
    config,
    data: parseResult?.data || {},
    blockResults: parseResult?.blocks || [],
  }

  if (parseResult?.regionResults?.length) {
    session.regionResults = parseResult.regionResults
  }

  return session
}

/**
 * Produces a deterministic representation of semantic session content.
 * `exportedAt` deliberately remains in user-facing exports, but it is metadata
 * rather than extraction configuration or output and therefore excluded here.
 */
export function canonicalSessionJson(session: ExportedSession): string {
  const { exportedAt: _exportedAt, ...semanticSession } = session
  return stableStringify(semanticSession)
}

/**
 * Normalizes supported historical session versions into the current v2 shape.
 * v1 had no region configuration; v2 always carries an explicit regions array.
 */
export function loadSession(value: unknown): SessionLoadResult {
  if (!isRecord(value)) return { errors: ['Invalid config file: expected a JSON object.'] }
  if (value.version !== 1 && value.version !== CURRENT_SESSION_VERSION) return { errors: ['Invalid config file: unsupported session version.'] }
  if (!isRecord(value.config) || !Array.isArray(value.config.blocks)) return { errors: ['Invalid config file: missing blocks array.'] }
  const errors = value.config.blocks.map(validateBlock).filter((error): error is string => Boolean(error))
  if (value.version === 2 && value.config.regions !== undefined && !Array.isArray(value.config.regions)) {
    errors.push('Invalid config file: regions must be an array.')
  }
  if (Array.isArray(value.config.regions)) {
    errors.push(...value.config.regions.map(validateRegion).filter((error): error is string => Boolean(error)))
  }
  if (errors.length) return { errors }
  if (typeof value.config.activeBlockId !== 'string') return { errors: ['Invalid config file: activeBlockId must be a string.'] }
  const focusMode = value.config.focusMode === 'activate-first' ? 'activate-first' : 'always-editable'
  const regions = value.version === 2 && Array.isArray(value.config.regions) ? value.config.regions as RegionConfig[] : []
  return {
    errors: [],
    migratedFrom: value.version === 1 ? 1 : undefined,
    session: {
      blocks: value.config.blocks as BlockConfig[],
      regions,
      activeBlockId: value.config.activeBlockId || (value.config.blocks[0] as BlockConfig | undefined)?.id || '',
      focusMode,
      parseResult: {
        success: true,
        data: isRecord(value.data) ? value.data : {},
        blocks: Array.isArray(value.blockResults) ? value.blockResults as ParseResult['blocks'] : [],
        regionResults: Array.isArray(value.regionResults) ? value.regionResults as RegionParseResult[] : undefined,
      },
    },
  }
}

export function deserializeSession(json: ExportedSession): DeserializedSession {
  const result = loadSession(json)
  if (!result.session) throw new Error(result.errors.join(' '))
  return result.session
}

export interface DeserializedProject {
  project: ProjectConfig
  parseResult: ParseResult | null
}

export interface ProjectLoadResult {
  project?: DeserializedProject
  errors: string[]
  migratedFrom?: 1 | 2
}

function validateWorkbook(value: unknown, index: number): string | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name) {
    return `Invalid project workbook at index ${index}.`
  }
  if (value.sheetNames !== undefined && (!Array.isArray(value.sheetNames) || value.sheetNames.some(name => typeof name !== 'string'))) {
    return `Invalid project workbook at index ${index}: sheetNames must be an array of strings.`
  }
  if (value.activeSheetName !== undefined && value.activeSheetName !== null && typeof value.activeSheetName !== 'string') {
    return `Invalid project workbook at index ${index}: activeSheetName must be a string or null.`
  }
  if (value.sourcePath !== undefined && (typeof value.sourcePath !== 'string' || !value.sourcePath)) {
    return `Invalid project workbook at index ${index}: sourcePath must be a non-empty string.`
  }
  return null
}

function parseResultFrom(value: Record<string, unknown>): ParseResult {
  return {
    success: true,
    data: isRecord(value.data) ? value.data : {},
    blocks: Array.isArray(value.blockResults) ? value.blockResults as ParseResult['blocks'] : [],
    regionResults: Array.isArray(value.regionResults) ? value.regionResults as RegionParseResult[] : undefined,
  }
}

/**
 * Serializes the complete project, including configured workbook source paths.
 * The desktop host authorizes those paths when the project is opened and the
 * renderer asks the user to reassign or remove any unavailable source.
 */
export function serializeProject(project: ProjectConfig, parseResult: ParseResult | null): ExportedProject {
  return {
    version: CURRENT_PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    data: parseResult?.data || {},
    blockResults: parseResult?.blocks || [],
    ...(parseResult?.regionResults?.length ? { regionResults: parseResult.regionResults } : {}),
  }
}

/**
 * Accepts the project schema and migrates legacy v1/v2 sessions into a
 * one-workbook project. Legacy sessions do not carry a stable workbook ID, so
 * their workbook is explicitly marked as needing attachment on import.
 */
export function loadProject(value: unknown): ProjectLoadResult {
  if (!isRecord(value)) return { errors: ['Invalid project file: expected a JSON object.'] }

  if (value.version === CURRENT_PROJECT_VERSION) {
    if (!isRecord(value.project)) return { errors: ['Invalid project file: missing project object.'] }
    const project = value.project
    if (typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.workbooks) || !Array.isArray(project.blocks) || !Array.isArray(project.regions)) {
      return { errors: ['Invalid project file: project fields are incomplete.'] }
    }
    const errors = project.workbooks.map(validateWorkbook).filter((error): error is string => Boolean(error))
    errors.push(...project.blocks.map(validateBlock).filter((error): error is string => Boolean(error)))
    errors.push(...project.regions.map(validateRegion).filter((error): error is string => Boolean(error)))
    const workbookIds = (project.workbooks as ProjectWorkbook[]).map(workbook => workbook.id)
    const ids = new Set(workbookIds)
    if (ids.size !== workbookIds.length) errors.push('Invalid project file: duplicate workbook IDs.')
    const blockIds = (project.blocks as BlockConfig[]).map(block => block.id)
    const regionIds = (project.regions as RegionConfig[]).map(region => region.id)
    if (new Set(blockIds).size !== blockIds.length) errors.push('Invalid project file: duplicate block IDs.')
    if (new Set(regionIds).size !== regionIds.length) errors.push('Invalid project file: duplicate region IDs.')
    if (project.activeWorkbookId !== null && project.activeWorkbookId !== undefined && (typeof project.activeWorkbookId !== 'string' || !ids.has(project.activeWorkbookId))) {
      errors.push('Invalid project file: active workbook is unavailable.')
    }
    for (const item of [...project.blocks as BlockConfig[], ...project.regions as RegionConfig[]]) {
      if (typeof item.workbookId !== 'string' || !item.workbookId) {
        errors.push(`Invalid project file: item "${item.label}" has no workbook mapping.`)
      } else if (!ids.has(item.workbookId)) {
        errors.push(`Invalid project file: item references unavailable workbook "${item.workbookId}".`)
      }
    }
    const activeBlock = (project.blocks as BlockConfig[]).find(block => block.id === project.activeBlockId)
    const activeRegion = (project.regions as RegionConfig[]).find(region => region.id === project.activeRegionId)
    if (project.activeBlockId && (!activeBlock || activeBlock.workbookId !== project.activeWorkbookId)) {
      errors.push('Invalid project file: active block does not belong to the active workbook.')
    }
    if (project.activeRegionId && (!activeRegion || activeRegion.workbookId !== project.activeWorkbookId)) {
      errors.push('Invalid project file: active region does not belong to the active workbook.')
    }
    if (errors.length) return { errors }
    return {
      errors: [],
      project: {
        project: {
          id: project.id,
          name: project.name,
          workbooks: project.workbooks as ProjectWorkbook[],
          activeWorkbookId: typeof project.activeWorkbookId === 'string' ? project.activeWorkbookId : null,
          blocks: project.blocks as BlockConfig[],
          regions: project.regions as RegionConfig[],
          activeBlockId: typeof project.activeBlockId === 'string' ? project.activeBlockId : '',
          activeRegionId: typeof project.activeRegionId === 'string' ? project.activeRegionId : null,
          focusMode: project.focusMode === 'activate-first' ? 'activate-first' : 'always-editable',
        },
        parseResult: parseResultFrom(value),
      },
    }
  }

  const legacy = loadSession(value)
  if (!legacy.session) return { errors: legacy.errors }
  const sourceFileName = typeof value.sourceFileName === 'string' && value.sourceFileName ? value.sourceFileName : 'Workbook to attach'
  const workbook = { id: LEGACY_WORKBOOK_ID, name: sourceFileName }
  return {
    errors: [],
    migratedFrom: value.version === 1 ? 1 : 2,
    project: {
      project: {
        id: `project-${Date.now()}`,
        name: 'Imported project',
        workbooks: [workbook],
        activeWorkbookId: workbook.id,
        blocks: legacy.session.blocks.map(block => ({ ...block, workbookId: workbook.id })),
        regions: legacy.session.regions.map(region => ({ ...region, workbookId: workbook.id })),
        activeBlockId: legacy.session.activeBlockId,
        activeRegionId: null,
        focusMode: legacy.session.focusMode,
      },
      parseResult: legacy.session.parseResult,
    },
  }
}
