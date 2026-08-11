import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import type { ExportedProject } from '../types'
import { canonicalProjectJson, loadProject, serializeProject } from '../services/serializer'

const schema = JSON.parse(readFileSync(new URL('../../../docs/project-v3.schema.json', import.meta.url), 'utf8'))
const completeFixture = JSON.parse(readFileSync(new URL('./fixtures/project-v3-complete.json', import.meta.url), 'utf8')) as ExportedProject
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateSchema = ajv.compile(schema)

function clone<T>(value: T): T { return structuredClone(value) }

describe('Project v3 strict conformance', () => {
  it('accepts a complete-field golden fixture in schema and runtime', () => {
    expect(validateSchema(completeFixture), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(loadProject(completeFixture).errors).toEqual([])
  })

  it('round-trips every semantic field canonically without mutating input', () => {
    const input = clone(completeFixture)
    const loaded = loadProject(input)
    expect(loaded.project).toBeDefined()
    const encoded = serializeProject(loaded.project!.project, loaded.project!.parseResult)
    expect(canonicalProjectJson(encoded)).toBe(canonicalProjectJson(completeFixture))
    expect(input).toEqual(completeFixture)
    const second = loadProject(encoded)
    expect(second.project).toBeDefined()
    expect(canonicalProjectJson(serializeProject(second.project!.project, second.project!.parseResult)))
      .toBe(canonicalProjectJson(encoded))
  })

  const structuralCases: Array<[string, (value: Record<string, any>) => void]> = [
    ['missing version', value => { delete value.version }],
    ['missing exportedAt', value => { delete value.exportedAt }],
    ['invalid exportedAt', value => { value.exportedAt = 'yesterday' }],
    ['missing project', value => { delete value.project }],
    ['wrong project name type', value => { value.project.name = 3 }],
    ['unknown top-level field', value => { value.unknown = true }],
    ['unknown project field', value => { value.project.unknown = true }],
    ['missing workbook ID', value => { delete value.project.workbooks[0].id }],
    ['wrong workbook sheetNames type', value => { value.project.workbooks[0].sheetNames = 'Orders' }],
    ['invalid active sheet type', value => { value.project.workbooks[0].activeSheetName = 4 }],
    ['invalid range coordinates', value => { value.project.blocks[0].range.startRow = -1 }],
    ['inverted range coordinates', value => { value.project.blocks[0].range.endRow = -1 }],
    ['missing block columns', value => { delete value.project.blocks[0].columns }],
    ['invalid column type', value => { value.project.blocks[0].columns[0].type = 'currency' }],
    ['invalid value mapping', value => { value.project.blocks[0].columns[0].valueMap[0].from = false }],
    ['conflicting row filter fields', value => { value.project.blocks[0].ignoreRules = [] }],
    ['empty row filter group', value => { value.project.blocks[0].rowFilter.condition = { type: 'all', conditions: [] } }],
    ['invalid not-in values', value => { value.project.blocks[0].rowFilter.condition = { type: 'rule', column: 'status', operator: 'notIn', value: 'deleted' } }],
    ['empty row filter column', value => { value.project.blocks[0].rowFilter.condition = { type: 'rule', column: '', operator: 'eq', value: 'active' } }],
    ['empty row filter value', value => { value.project.blocks[0].rowFilter.condition = { type: 'rule', column: 'status', operator: 'eq', value: '' } }],
    ['empty value in row filter list', value => { value.project.blocks[0].rowFilter.condition = { type: 'rule', column: 'status', operator: 'in', values: [''] } }],
    ['invalid region split rule', value => { value.project.regions[0].splitRules[0].type = 'regex' }],
    ['wrong data primitive', value => { value.data = [] }],
    ['wrong block results type', value => { value.blockResults = {} }],
    ['invalid result rows', value => { value.regionResults[0].blocks[0].rows = [[1]] }],
    ['missing result workbook owner', value => { delete value.blockResults[0].workbookId }],
  ]

  it.each(structuralCases)('rejects %s in schema and runtime', (_name, mutate) => {
    const invalid = clone(completeFixture) as unknown as Record<string, any>
    mutate(invalid)
    expect(validateSchema(invalid)).toBe(false)
    expect(loadProject(invalid).project).toBeUndefined()
  })

  it('rejects unsupported versions with a stable diagnostic', () => {
    const invalid = { ...clone(completeFixture), version: 4 }
    expect(validateSchema(invalid)).toBe(false)
    expect(loadProject(invalid).errors).toContain('Invalid project file: unsupported project version.')
  })

  it('rejects condition trees deeper than the runtime safety limit', () => {
    const invalid = clone(completeFixture)
    let condition: any = { type: 'rule', column: 'status', operator: 'eq', value: 'active' }
    for (let depth = 0; depth < 11; depth += 1) condition = { type: 'all', conditions: [condition] }
    invalid.project.blocks[0].rowFilter!.condition = condition
    expect(loadProject(invalid).project).toBeUndefined()
  })

  it('enforces semantic ownership beyond structural schema checks', () => {
    const duplicate = clone(completeFixture)
    duplicate.project.workbooks[1].id = duplicate.project.workbooks[0].id
    expect(loadProject(duplicate).errors).toContain('Invalid project file: duplicate workbook IDs.')

    const dangling = clone(completeFixture)
    dangling.project.blocks[0].workbookId = 'missing'
    expect(loadProject(dangling).errors.join(' ')).toContain('references unavailable workbook')

    const wrongActiveOwner = clone(completeFixture)
    wrongActiveOwner.project.activeWorkbookId = 'costs'
    expect(loadProject(wrongActiveOwner).errors.join(' ')).toContain('active block does not belong')
  })

  it('allows equal labels in different workbooks', () => {
    expect(completeFixture.project.blocks[0].label).toBe(completeFixture.project.blocks[1].label)
    expect(loadProject(completeFixture).errors).toEqual([])
  })

  it('normalizes the released v3 row-rule array into the canonical condition tree', () => {
    const releasedV3 = clone(completeFixture)
    delete releasedV3.project.blocks[0].rowFilter
    ;(releasedV3.project.blocks[0] as any).ignoreRules = [
      { column: 'status', operator: 'neq', value: 'deleted' },
      { column: 'amount', operator: 'regex', value: '^\\d+$' },
    ]
    expect(validateSchema(releasedV3), JSON.stringify(validateSchema.errors)).toBe(true)
    const loaded = loadProject(releasedV3)
    expect(loaded.errors).toEqual([])
    expect(loaded.project!.project.blocks[0].rowFilter).toEqual({
      removeEmptyRows: true,
      emptyCellConditions: { fullyStruck: true },
      condition: {
        type: 'all',
        conditions: [
          { type: 'rule', column: 'status', operator: 'neq', value: 'deleted' },
          { type: 'rule', column: 'amount', operator: 'regex', value: '^\\d+$' },
        ],
      },
    })
    expect((loaded.project!.project.blocks[0] as any).ignoreRules).toBeUndefined()
  })
})
