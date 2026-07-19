import type { BlockConfig, RegionConfig, RegionParseResult, SessionConfig, ExportedSession, ParseResult } from '../types'

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
