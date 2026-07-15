import type { BlockConfig, RegionConfig, SessionConfig, ExportedSession, ParseResult } from '../types'

export interface DeserializedSession {
  blocks: BlockConfig[]
  regions: RegionConfig[]
  activeBlockId: string
  focusMode: 'always-editable' | 'activate-first'
  parseResult: ParseResult | null
}

export function serializeSession(
  blocks: BlockConfig[],
  regions: RegionConfig[],
  activeBlockId: string,
  focusMode: 'always-editable' | 'activate-first',
  parseResult: ParseResult | null,
): ExportedSession {
  const hasRegions = regions.length > 0
  const config: SessionConfig = {
    blocks,
    activeBlockId,
    focusMode,
  }
  if (hasRegions) {
    config.regions = regions
  }

  const session: ExportedSession = {
    version: hasRegions ? 2 : 1,
    exportedAt: new Date().toISOString(),
    config,
    data: parseResult?.data || {},
    blockResults: parseResult?.blocks || [],
  }

  if (hasRegions && parseResult?.regionResults?.length) {
    session.regionResults = parseResult.regionResults
  }

  return session
}

export function deserializeSession(json: ExportedSession): DeserializedSession {
  const config = json.config
  const blocks = config.blocks || []
  const regions = (json.version >= 2 && config.regions) ? config.regions : []

  return {
    blocks,
    regions,
    activeBlockId: config.activeBlockId || blocks[0]?.id || '',
    focusMode: config.focusMode || 'always-editable',
    parseResult: {
      success: true,
      data: json.data || {},
      blocks: json.blockResults || [],
      regionResults: json.regionResults,
    },
  }
}
