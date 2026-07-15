import { describe, it, expect } from 'vitest'

describe('SplitRule', () => {
  it('creates keyword split rule', () => {
    const rule: import('../types').SplitRule = { type: 'keyword' as const, keyword: '---' }
    expect(rule.type).toBe('keyword')
    expect(rule.keyword).toBe('---')
  })
  it('creates emptyRow split rule', () => {
    const rule: import('../types').SplitRule = { type: 'emptyRow' as const }
    expect(rule.type).toBe('emptyRow')
  })
  it('creates emptyColumn split rule', () => {
    const rule: import('../types').SplitRule = { type: 'emptyColumn' as const, minGap: 2 }
    expect(rule.type).toBe('emptyColumn')
    expect(rule.minGap).toBe(2)
  })
})

describe('RowIgnoreRule', () => {
  it('creates equality rule', () => {
    const rule: import('../types').RowIgnoreRule = { column: 'status', operator: 'eq' as const, value: 'active' }
    expect(rule.operator).toBe('eq')
  })
  it('creates empty rule', () => {
    const rule: import('../types').RowIgnoreRule = { operator: 'empty' as const }
    expect(rule.operator).toBe('empty')
    expect(rule.value).toBeUndefined()
  })
  it('creates regex rule', () => {
    const rule: import('../types').RowIgnoreRule = { operator: 'regex' as const, value: '^\\d+' }
    expect(rule.operator).toBe('regex')
  })
})

describe('Tag', () => {
  it('creates label tag', () => {
    const tag: import('../types').Tag = { type: 'label' as const, key: 'invoice' }
    expect(tag.type).toBe('label')
    expect(tag.key).toBe('invoice')
    expect(tag.value).toBeUndefined()
  })
  it('creates kv tag', () => {
    const tag: import('../types').Tag = { type: 'kv' as const, key: 'department', value: 'sales' }
    expect(tag.type).toBe('kv')
    expect(tag.key).toBe('department')
    expect(tag.value).toBe('sales')
  })
})

describe('ComputedProperty', () => {
  it('creates computed property', () => {
    const prop: import('../types').ComputedProperty = {
      id: 'cp1',
      label: 'Total',
      expression: "row['amount'] * row['price']",
    }
    expect(prop.id).toBe('cp1')
    expect(prop.expression).toContain('amount')
  })
})

describe('RegionConfig', () => {
  it('creates region with blocks', () => {
    const region: import('../types').RegionConfig = {
      id: 'r1',
      label: 'Region 1',
      range: null,
      activeSheet: null,
      splitRules: [],
      blocks: [],
      collapsed: false,
      selectionLocked: false,
    }
    expect(region.id).toBe('r1')
    expect(region.blocks).toEqual([])
  })
})

describe('BlockConfig extensions', () => {
  it('creates BlockConfig with optional region fields', () => {
    const config: import('../types').BlockConfig = {
      id: 'b1',
      label: 'Block 1',
      range: null,
      activeSheet: null,
      headerRows: [],
      collapsed: false,
      selectionLocked: false,
      columns: [],
      dataSnapshot: null,
      ignoreRules: [{ operator: 'empty' as const }],
      skipEmptyColumns: true,
      tags: [{ type: 'label' as const, key: 'invoice' }],
      computedProperties: [{ id: 'cp1', label: 'Total', expression: 'sum' }],
    }
    expect(config.skipEmptyColumns).toBe(true)
    expect(config.tags).toHaveLength(1)
    expect(config.ignoreRules![0].operator).toBe('empty')
  })
})

describe('ExportedSession version', () => {
  it('accepts version 2', () => {
    const session: import('../types').ExportedSession = {
      version: 2,
      exportedAt: new Date().toISOString(),
      config: { blocks: [], activeBlockId: '', focusMode: 'activate-first' },
      data: {},
      blockResults: [],
    }
    expect(session.version).toBe(2)
  })
  it('accepts version 1', () => {
    const session: import('../types').ExportedSession = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: { blocks: [], activeBlockId: '', focusMode: 'activate-first' },
      data: {},
      blockResults: [],
    }
    expect(session.version).toBe(1)
  })
})

describe('SessionConfig regions', () => {
  it('accepts optional regions field', () => {
    const config: import('../types').SessionConfig = {
      blocks: [],
      activeBlockId: '',
      focusMode: 'activate-first',
      regions: [{
        id: 'r1',
        label: 'R1',
        range: null,
        activeSheet: null,
        splitRules: [],
        blocks: [],
        collapsed: false,
        selectionLocked: false,
      }],
    }
    expect(config.regions).toHaveLength(1)
  })
})

describe('RegionBlockResult and RegionParseResult', () => {
  it('creates region parse result', () => {
    const result: import('../types').RegionParseResult = {
      regionId: 'r1',
      label: 'Region 1',
      blocks: [
        { blockLabel: 'Header', rows: [['a', 'b']] },
      ],
    }
    expect(result.regionId).toBe('r1')
    expect(result.blocks[0].rows[0]).toEqual(['a', 'b'])
  })
})
