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

describe('RowFilterRule', () => {
  it('creates equality rule', () => {
    const rule: import('../types').RowFilterRule = { type: 'rule', column: 'status', operator: 'eq', value: 'active' }
    expect(rule.operator).toBe('eq')
  })
  it('creates empty rule', () => {
    const rule: import('../types').RowFilterRule = { type: 'rule', column: 'status', operator: 'empty' }
    expect(rule.operator).toBe('empty')
    expect(rule.value).toBeUndefined()
  })
  it('creates regex rule', () => {
    const rule: import('../types').RowFilterRule = { type: 'rule', column: 'status', operator: 'regex', value: '^\\d+' }
    expect(rule.operator).toBe('regex')
  })
  it('creates nested all/any groups', () => {
    const condition: import('../types').RowFilterCondition = {
      type: 'all',
      conditions: [{ type: 'rule', column: 'status', operator: 'notIn', values: ['deleted'] }],
    }
    expect(condition.conditions).toHaveLength(1)
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
      rowFilter: {
        removeEmptyRows: true,
        emptyCellConditions: { fullyStruck: true },
        condition: { type: 'rule', column: 'status', operator: 'empty' },
      },
      skipEmptyColumns: true,
      tags: [{ type: 'label' as const, key: 'invoice' }],
      computedProperties: [{ id: 'cp1', label: 'Total', expression: 'sum' }],
    }
    expect(config.skipEmptyColumns).toBe(true)
    expect(config.tags).toHaveLength(1)
    expect(config.rowFilter!.condition).toMatchObject({ operator: 'empty' })
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
