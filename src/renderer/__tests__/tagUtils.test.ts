import { describe, it, expect } from 'vitest'
import { addTag, removeTag, filterBlocksByTag, getAllTags } from '../services/tagUtils'
import type { BlockConfig, Tag } from '../types'

function makeBlock(overrides?: Partial<BlockConfig>): BlockConfig {
  return {
    id: 'b1',
    label: 'Test',
    range: null,
    activeSheet: null,
    headerRows: [],
    collapsed: false,
    selectionLocked: false,
    columns: [],
    dataSnapshot: null,
    ...overrides,
  }
}

describe('addTag', () => {
  it('adds label tag to block with no tags', () => {
    const block = makeBlock()
    const tag: Tag = { type: 'label', key: 'invoice' }
    const result = addTag(block, tag)
    expect(result.tags).toEqual([tag])
  })

  it('adds kv tag to block', () => {
    const block = makeBlock()
    const tag: Tag = { type: 'kv', key: 'department', value: 'sales' }
    const result = addTag(block, tag)
    expect(result.tags).toEqual([tag])
  })

  it('replaces existing tag with same key (dedup)', () => {
    const block = makeBlock({ tags: [{ type: 'label', key: 'status' }] })
    const replacement: Tag = { type: 'kv', key: 'status', value: 'active' }
    const result = addTag(block, replacement)
    expect(result.tags).toEqual([replacement])
  })

  it('original block unchanged (immutability)', () => {
    const block = makeBlock()
    const tag: Tag = { type: 'label', key: 'invoice' }
    addTag(block, tag)
    expect(block.tags).toBeUndefined()
  })
})

describe('removeTag', () => {
  it('removes tag by key', () => {
    const block = makeBlock({ tags: [{ type: 'label', key: 'invoice' }] })
    const result = removeTag(block, 'invoice')
    expect(result.tags).toEqual([])
  })

  it('key not found returns same block', () => {
    const block = makeBlock({ tags: [{ type: 'label', key: 'invoice' }] })
    const result = removeTag(block, 'nonexistent')
    expect(result).toBe(block)
  })

  it('original block unchanged', () => {
    const block = makeBlock({ tags: [{ type: 'label', key: 'invoice' }] })
    removeTag(block, 'invoice')
    expect(block.tags).toEqual([{ type: 'label', key: 'invoice' }])
  })
})

describe('filterBlocksByTag', () => {
  const blocks = [
    makeBlock({ id: 'b1', tags: [{ type: 'label', key: 'invoice' }] }),
    makeBlock({ id: 'b2', tags: [{ type: 'kv', key: 'department', value: 'sales' }] }),
    makeBlock({ id: 'b3', tags: [] }),
    makeBlock({ id: 'b4', tags: [{ type: 'label', key: 'urgent' }] }),
  ]

  it('empty filter returns all blocks', () => {
    expect(filterBlocksByTag(blocks, '')).toHaveLength(4)
  })

  it('matches label tag key', () => {
    const result = filterBlocksByTag(blocks, 'invoice')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b1')
  })

  it('matches kv tag value', () => {
    const result = filterBlocksByTag(blocks, 'sales')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b2')
  })

  it('case-insensitive match', () => {
    const result = filterBlocksByTag(blocks, 'INVOICE')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b1')
  })

  it('no match returns empty array', () => {
    expect(filterBlocksByTag(blocks, 'nonexistent')).toEqual([])
  })
})

describe('getAllTags', () => {
  it('deduplicates by key', () => {
    const blocks = [
      makeBlock({ tags: [{ type: 'label', key: 'invoice' }, { type: 'kv', key: 'department', value: 'eng' }] }),
      makeBlock({ tags: [{ type: 'label', key: 'invoice' }, { type: 'kv', key: 'department', value: 'sales' }] }),
    ]
    const result = getAllTags(blocks)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: 'label', key: 'invoice' })
    expect(result[1]).toEqual({ type: 'kv', key: 'department', value: 'eng' })
  })

  it('empty blocks returns empty array', () => {
    expect(getAllTags([])).toEqual([])
  })

  it('mixed label and kv tags', () => {
    const blocks = [
      makeBlock({ tags: [{ type: 'label', key: 'urgent' }] }),
      makeBlock({ tags: [{ type: 'kv', key: 'dept', value: 'sales' }] }),
    ]
    const result = getAllTags(blocks)
    expect(result).toEqual([
      { type: 'label', key: 'urgent' },
      { type: 'kv', key: 'dept', value: 'sales' },
    ])
  })
})
