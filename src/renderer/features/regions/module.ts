import type { ProjectFeatureModule } from '../core/projectFeature'
import type { RegionParseResult } from '../../types'
import { generateColumnMappings, parseProjectRegions } from '../../services/extraction'
import { regionValidationIssues, validateRegions } from './validation'

export const regionFeatureModule: ProjectFeatureModule = {
  id: 'builtin.regions',
  schemaVersion: 1,
  initialize: project => project,
  activateWorkbook: project => ({ ...project, activeRegionId: null }),
  workbookLoaded: project => project,
  removeWorkbook(project, workbookId) {
    const regions = project.regions.filter(region => region.workbookId !== workbookId)
    return { ...project, regions, activeRegionId: regions.some(region => region.id === project.activeRegionId) ? project.activeRegionId : null }
  },
  prepareForSave(project) {
    const regions = project.regions.filter(region => Boolean(region.workbookId))
    return { ...project, regions, activeRegionId: regions.some(region => region.id === project.activeRegionId) ? project.activeRegionId : null }
  },
  validate: validateRegions,
  diagnosticFocus(project, diagnostic) {
    if (!diagnostic.regionId) return null
    const region = project.regions.find(item => item.id === diagnostic.regionId)
    return region ? { workbookId: region.workbookId ?? null, sheetName: region.activeSheet, range: region.range, featureId: 'builtin.regions', itemId: region.id } : null
  },
  applyDiagnosticFocus(project, target) {
    if (target.featureId !== 'builtin.regions' || !target.itemId || !project.regions.some(region => region.id === target.itemId)) return project
    return { ...project, activeRegionId: target.itemId, activeBlockId: '' }
  },
  selectionChanged(project, event) {
    const region = project.regions.find(item => item.id === project.activeRegionId && item.workbookId === event.workbookId)
    if (!region || region.selectionLocked) return project
    return {
      ...project,
      regions: project.regions.map(item => item.id === region.id ? { ...item, range: event.range, activeSheet: event.activeSheet } : item),
    }
  },
  canvasRanges(project, workbookId) {
    return project.regions
      .filter(region => region.workbookId === workbookId && region.selectionLocked && region.range)
      .map(region => ({ itemId: region.id, range: region.range!, activeSheet: region.activeSheet, color: '#1677ff' }))
  },
  activeCanvasItems(project) {
    return project.activeRegionId ? [project.activeRegionId] : []
  },
  executionReady: project => project.regions.some(region => Boolean(region.range)),
  execute(project, workbooks) {
    const validationIssues = regionValidationIssues(project)
    if (validationIssues.length) {
      return { diagnostics: validationIssues.map(issue => ({ code: 'invalid-range' as const, severity: 'error' as const, ...issue })) }
    }
    const execution = parseProjectRegions(workbooks, project.regions)
    return { resultFields: { regionResults: execution.regionResults }, diagnostics: execution.diagnostics }
  },
  applyExecution(project, execution) {
    const regionResults = execution.resultFields?.regionResults as RegionParseResult[] | undefined
    if (!regionResults) return project
    const byId = new Map(regionResults.map(result => [result.regionId, result]))
    return {
      ...project,
      regions: project.regions.map(region => {
        const result = byId.get(region.id)
        if (!result) return region
        return {
          ...region,
          blocks: result.blocks.filter(block => block.range).map((block, index) => ({
            id: `${region.id}:detected:${index + 1}`,
            label: block.blockLabel,
            workbookId: region.workbookId,
            range: block.range!,
            activeSheet: region.activeSheet,
            headerRows: [],
            collapsed: false,
            selectionLocked: true,
            columns: generateColumnMappings(block.range!),
            dataSnapshot: block.rows,
          })),
        }
      }),
    }
  },
}
