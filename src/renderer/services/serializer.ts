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

function validateBlock(value: unknown, index: number): string | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return `Invalid block at index ${index}: id and label must be strings.`
  if (!Array.isArray(value.columns) || !Array.isArray(value.headerRows)) return `Invalid block "${value.label}": columns and headerRows must be arrays.`
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
