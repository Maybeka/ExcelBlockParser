import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { serializeSession, deserializeSession, loadSession } from '../services/serializer'
import type { BlockConfig, RegionConfig, ExportedSession } from '../types'

const mockBlock: BlockConfig = {
  id: 'block-1',
  label: 'block_1',
  range: null,
  activeSheet: null,
  headerRows: [0],
  collapsed: false,
  selectionLocked: false,
  columns: [],
  dataSnapshot: null,
}

const mockRegion: RegionConfig = {
  id: 'region-1',
  label: 'Region 1',
  range: null,
  activeSheet: null,
  splitRules: [],
  blocks: [],
  collapsed: false,
  selectionLocked: false,
}

describe('serializeSession', () => {
  it('creates canonical v2 session without regions', () => {
    const result = serializeSession(
      [mockBlock],
      [],
      'block-1',
      'always-editable',
      null,
    )

    expect(result.version).toBe(2)
    expect(result.config.blocks).toHaveLength(1)
    expect(result.config.regions).toEqual([])
    expect(result.data).toEqual({})
    expect(result.blockResults).toEqual([])
  })

  it('creates v2 session with regions', () => {
    const result = serializeSession(
      [mockBlock],
      [mockRegion],
      'block-1',
      'always-editable',
      null,
    )

    expect(result.version).toBe(2)
    expect(result.config.blocks).toHaveLength(1)
    expect(result.config.regions).toBeDefined()
    expect(result.config.regions).toHaveLength(1)
    expect(result.config.regions![0].id).toBe('region-1')
  })

  it('sets exportedAt to a valid ISO string', () => {
    const result = serializeSession(
      [mockBlock],
      [],
      'block-1',
      'activate-first',
      null,
    )

    expect(result.exportedAt).toBeDefined()
    expect(() => new Date(result.exportedAt)).not.toThrow()
    expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt)
  })

  it('includes parseResult data and block results when provided', () => {
    const parseResult = {
      success: true,
      data: { total: 100 },
      blocks: [{ blockId: 'block-1', label: 'block_1', data: [{ key: 'val' }], rowCount: 1 }],
    }

    const result = serializeSession(
      [mockBlock],
      [],
      'block-1',
      'always-editable',
      parseResult,
    )

    expect(result.data).toEqual({ total: 100 })
    expect(result.blockResults).toHaveLength(1)
    expect(result.blockResults[0].blockId).toBe('block-1')
  })

  it('handles empty blocks and regions arrays', () => {
    const result = serializeSession(
      [],
      [],
      '',
      'always-editable',
      null,
    )

    expect(result.version).toBe(2)
    expect(result.config.blocks).toEqual([])
    expect(result.config.regions).toEqual([])
  })
})

describe('deserializeSession', () => {
  it('deserializes v1 session without regions', () => {
    const json: ExportedSession = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [mockBlock],
        activeBlockId: 'block-1',
        focusMode: 'always-editable',
      },
      data: {},
      blockResults: [],
    }

    const result = deserializeSession(json)

    expect(result.blocks).toHaveLength(1)
    expect(result.regions).toEqual([])
    expect(result.activeBlockId).toBe('block-1')
    expect(result.focusMode).toBe('always-editable')
    expect(result.parseResult).toBeDefined()
    expect(result.parseResult!.success).toBe(true)
  })

  it('deserializes v2 session with regions', () => {
    const json: ExportedSession = {
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [mockBlock],
        activeBlockId: 'block-1',
        focusMode: 'always-editable',
        regions: [mockRegion],
      },
      data: {},
      blockResults: [],
    }

    const result = deserializeSession(json)

    expect(result.blocks).toHaveLength(1)
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0].id).toBe('region-1')
    expect(result.activeBlockId).toBe('block-1')
    expect(result.focusMode).toBe('always-editable')
  })

  it('returns empty regions array for v1 JSON', () => {
    const v1Json: ExportedSession = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [mockBlock],
        activeBlockId: 'block-1',
        focusMode: 'always-editable',
      },
      data: {},
      blockResults: [],
    }

    const result = deserializeSession(v1Json)
    expect(result.regions).toEqual([])
  })

  it('falls back to first block id when activeBlockId is empty', () => {
    const json: ExportedSession = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [mockBlock],
        activeBlockId: '',
        focusMode: 'always-editable',
      },
      data: {},
      blockResults: [],
    }

    const result = deserializeSession(json)
    expect(result.activeBlockId).toBe('block-1')
  })

  it('returns empty string for activeBlockId when blocks are empty', () => {
    const json: ExportedSession = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [],
        activeBlockId: '',
        focusMode: 'always-editable',
      },
      data: {},
      blockResults: [],
    }

    const result = deserializeSession(json)
    expect(result.blocks).toEqual([])
    expect(result.regions).toEqual([])
    expect(result.activeBlockId).toBe('')
  })

  it('defaults focusMode to always-editable when missing', () => {
    const json = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [mockBlock],
        activeBlockId: 'block-1',
      } as ExportedSession['config'],
      data: {},
      blockResults: [],
    } as ExportedSession

    const result = deserializeSession(json)
    expect(result.focusMode).toBe('always-editable')
  })
})

describe('round-trip', () => {
  it('preserves blocks in v1 round-trip', () => {
    const blocks = [
      { ...mockBlock, id: 'b1', label: 'first' },
      { ...mockBlock, id: 'b2', label: 'second' },
    ]

    const serialized = serializeSession(blocks, [], 'b1', 'always-editable', null)
    const deserialized = deserializeSession(serialized)

    expect(deserialized.blocks).toHaveLength(2)
    expect(deserialized.blocks[0].id).toBe('b1')
    expect(deserialized.blocks[1].id).toBe('b2')
    expect(deserialized.regions).toEqual([])
    expect(deserialized.activeBlockId).toBe('b1')
  })

  it('preserves regions in v2 round-trip', () => {
    const regions = [
      { ...mockRegion, id: 'r1', label: 'First Region' },
      { ...mockRegion, id: 'r2', label: 'Second Region' },
    ]

    const serialized = serializeSession(
      [mockBlock],
      regions,
      'block-1',
      'always-editable',
      null,
    )
    const deserialized = deserializeSession(serialized)

    expect(deserialized.regions).toHaveLength(2)
    expect(deserialized.regions[0].id).toBe('r1')
    expect(deserialized.regions[1].id).toBe('r2')
    expect(deserialized.blocks).toHaveLength(1)
  })

  it('preserves parseResult data through round-trip', () => {
    const parseResult = {
      success: true,
      data: { summary: 'test' },
      blocks: [{ blockId: 'block-1', label: 'block_1', data: [{ x: 1 }], rowCount: 1 }],
    }

    const serialized = serializeSession(
      [mockBlock],
      [],
      'block-1',
      'activate-first',
      parseResult,
    )
    const deserialized = deserializeSession(serialized)

    expect(deserialized.parseResult).toBeDefined()
    expect(deserialized.parseResult!.data).toEqual({ summary: 'test' })
    expect(deserialized.parseResult!.blocks).toHaveLength(1)
    expect(deserialized.parseResult!.blocks[0].blockId).toBe('block-1')
  })
})

describe('backward compatibility', () => {
  it('deserializes v1 JSON without regions field', () => {
    const v1Json: ExportedSession = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      config: {
        blocks: [mockBlock],
        activeBlockId: 'block-1',
        focusMode: 'always-editable',
      },
      data: { order: 42 },
      blockResults: [{ blockId: 'block-1', label: 'block_1', data: [], rowCount: 0 }],
    }

    const result = deserializeSession(v1Json)
    expect(result.blocks).toHaveLength(1)
    expect(result.regions).toEqual([])
    expect(result.parseResult!.data).toEqual({ order: 42 })
  })

  it('v1 JSON round-trip migrates to canonical version 2', () => {
    const serialized = serializeSession([mockBlock], [], 'block-1', 'always-editable', null)
    const roundTripped = serializeSession(
      serialized.config.blocks,
      [],
      serialized.config.activeBlockId,
      serialized.config.focusMode,
      null,
    )

    expect(roundTripped.version).toBe(2)
    expect(roundTripped.config.regions).toEqual([])
  })
})

describe('loadSession', () => {
  it('reports malformed templates without throwing', () => {
    expect(loadSession({ version: 2, config: { blocks: [] } }).errors).toContain('Invalid config file: activeBlockId must be a string.')
    expect(loadSession({ version: 3 }).errors).toContain('Invalid config file: unsupported session version.')
  })

  it('marks v1 sessions as migrated', () => {
    const result = loadSession({ version: 1, config: { blocks: [mockBlock], activeBlockId: 'block-1', focusMode: 'always-editable' }, data: {}, blockResults: [] })
    expect(result.migratedFrom).toBe(1)
    expect(result.session?.regions).toEqual([])
  })

  it('rejects malformed block ranges and column mappings before UI state is created', () => {
    const malformedRange = loadSession({
      version: 2,
      config: { blocks: [{ ...mockBlock, range: { startRow: -1 } }], activeBlockId: 'block-1', focusMode: 'always-editable', regions: [] },
    })
    const malformedColumn = loadSession({
      version: 2,
      config: { blocks: [{ ...mockBlock, columns: [{ ...mockBlock.columns[0], colIndex: 'A' }] }], activeBlockId: 'block-1', focusMode: 'always-editable', regions: [] },
    })

    expect(malformedRange.errors).toEqual(['Invalid block "block_1": range must be null or a valid cell range.'])
    expect(malformedColumn.errors).toEqual(['Invalid block "block_1": column 0 has an invalid position.'])
  })

  it('rejects malformed v2 regions before they reach the workspace', () => {
    const result = loadSession({
      version: 2,
      config: {
        blocks: [mockBlock],
        activeBlockId: 'block-1',
        focusMode: 'always-editable',
        regions: [{ id: 'region-1', label: 'Region 1', range: null, splitRules: [{ type: 'unknown' }], blocks: [] }],
      },
    })

    expect(result.errors).toEqual(['Invalid region "Region 1": splitRules contain an unsupported rule.'])
  })

  it('imports the tracked legacy session fixture and normalizes it safely', async () => {
    const content = await readFile(resolve(process.cwd(), 'examples', 'session 2.json'), 'utf8')
    const result = loadSession(JSON.parse(content))

    expect(result.errors).toEqual([])
    expect(result.migratedFrom).toBe(1)
    expect(result.session).toMatchObject({
      activeBlockId: 'block-465-1779981809582',
      focusMode: 'always-editable',
    })
    expect(result.session?.blocks).toHaveLength(1)
    expect(result.session?.regions).toEqual([])
  })
})
