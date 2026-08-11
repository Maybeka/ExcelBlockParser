import { describe, expect, it } from 'vitest'
import { regionFeatureModule } from '../features/regions/module'
import { validateRegions } from '../features/regions/validation'
import { createProject } from '../services/project'
import { loadProject, serializeProject } from '../services/serializer'
import type { ProjectConfig, RegionParseResult } from '../types'

function projectWithRegion(): ProjectConfig {
  return {
    ...createProject('Regions'),
    workbooks: [{ id: 'book', name: 'book.xlsx', sheetNames: ['Sheet1'], activeSheetName: 'Sheet1' }],
    activeWorkbookId: 'book',
    regions: [{
      id: 'region', label: 'region_1', workbookId: 'book', activeSheet: 'Sheet1',
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 3, a1Notation: 'A1:D4' },
      splitRules: [{ type: 'emptyColumn', minGap: 1 }], blocks: [], collapsed: false, selectionLocked: true,
    }],
  }
}

describe('Region feature module', () => {
  it('validates ownership, names, keyword rules, and minGap', () => {
    const project = projectWithRegion()
    project.regions.push({
      ...project.regions[0], id: 'bad', label: 'region_1', workbookId: 'missing',
      splitRules: [{ type: 'keyword', keyword: '' }, { type: 'emptyRow', minGap: 0 }],
    })
    expect(validateRegions(project)).toEqual(expect.arrayContaining([
      'Region "region_1" has no available workbook.',
      'Region "region_1" rule 1 requires a keyword.',
      'Region "region_1" rule 2 requires a positive integer minimum gap.',
    ]))
  })

  it('writes detected ranges and snapshots back to Region-owned child blocks', () => {
    const project = projectWithRegion()
    const regionResults: RegionParseResult[] = [{
      regionId: 'region', label: 'region_1', workbookId: 'book',
      blocks: [{
        blockLabel: 'block_1', rows: [['A', 'B'], ['1', '2']],
        range: { startRow: 0, startCol: 2, endRow: 1, endCol: 3, a1Notation: 'C1:D2' },
      }],
    }]
    const updated = regionFeatureModule.applyExecution!(project, { resultFields: { regionResults } })
    expect(updated.regions[0].blocks).toEqual([expect.objectContaining({
      id: 'region:detected:1', label: 'block_1', workbookId: 'book', activeSheet: 'Sheet1',
      dataSnapshot: [['A', 'B'], ['1', '2']],
      range: expect.objectContaining({ a1Notation: 'C1:D2' }),
    })])
    expect(updated.regions[0].blocks[0].columns.map(column => column.colLetter)).toEqual(['C', 'D'])

    const document = serializeProject(updated, { success: true, data: {}, blocks: [], regionResults })
    const reopened = loadProject(document)
    expect(reopened.errors).toEqual([])
    expect(reopened.project?.project.regions[0].blocks[0]).toMatchObject({
      id: 'region:detected:1', range: { a1Notation: 'C1:D2' },
    })
  })
})
