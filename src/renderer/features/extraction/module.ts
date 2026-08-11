import type { ProjectFeatureModule } from '../core/projectFeature'
import type { ProjectConfig } from '../../types'
import { blocksForWorkbook, createDefaultBlock } from './model'
import { validateBlocks } from './validation'
import { generateColumnMappings, parseProjectWorkbooks, suggestMappingsForWorkbook } from '../../services/extraction'
import { captureExtractionSnapshots } from '../../services/extractionPersistence'
import { adaptPreviewData } from '../../services/previewDataAdapter'

function nextBlockNumber(project: ProjectConfig): number {
  return project.blocks.reduce((max, block) => {
    const match = block.label.match(/^block_(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
}

export const extractionFeatureModule: ProjectFeatureModule = {
  id: 'builtin.extraction',
  schemaVersion: 1,
  initialize(project) {
    if (project.blocks.length) return project
    const block = createDefaultBlock(0, null)
    return { ...project, blocks: [block], activeBlockId: block.id }
  },
  activateWorkbook(project, workbookId) {
    return { ...project, activeBlockId: blocksForWorkbook(project, workbookId)[0]?.id ?? '' }
  },
  workbookLoaded(project, event) {
    const scoped = blocksForWorkbook(project, event.workbookId)
    if (scoped.length) return { ...project, activeBlockId: scoped[0].id }
    const drafts = project.blocks.filter(block => block.workbookId === null)
    if (drafts.length) {
      return {
        ...project,
        blocks: project.blocks.map(block => block.workbookId === null ? { ...block, workbookId: event.workbookId } : block),
        activeBlockId: drafts[0].id,
      }
    }
    const block = createDefaultBlock(nextBlockNumber(project), event.workbookId)
    return { ...project, blocks: [...project.blocks, block], activeBlockId: block.id }
  },
  removeWorkbook(project, workbookId) {
    const blocks = project.blocks.filter(block => block.workbookId !== workbookId)
    const activeBlockId = blocks.some(block => block.id === project.activeBlockId) ? project.activeBlockId : ''
    return { ...project, blocks, activeBlockId }
  },
  prepareForSave(project) {
    const blocks = project.blocks.filter(block => Boolean(block.workbookId))
    return { ...project, blocks, activeBlockId: blocks.some(block => block.id === project.activeBlockId) ? project.activeBlockId : blocks[0]?.id ?? '' }
  },
  captureForSave: (project, workbookId, spreadsheet) => captureExtractionSnapshots(project, workbookId, spreadsheet),
  validate: project => validateBlocks(project.blocks),
  diagnosticFocus(project, diagnostic) {
    if (!diagnostic.blockId) return null
    const block = project.blocks.find(item => item.id === diagnostic.blockId)
    return block ? { workbookId: block.workbookId ?? null, sheetName: block.activeSheet, range: block.range, featureId: 'builtin.extraction', itemId: block.id } : null
  },
  applyDiagnosticFocus(project, target) {
    if (target.featureId !== 'builtin.extraction' || !target.itemId || !project.blocks.some(block => block.id === target.itemId)) return project
    return { ...project, activeBlockId: target.itemId, activeRegionId: null }
  },
  selectionChanged(project, event, spreadsheet) {
    if (project.activeRegionId !== null) return project
    const block = project.blocks.find(item => item.id === project.activeBlockId && item.workbookId === event.workbookId)
    if (!block) return project
    let range = event.range
    if (range && range.startRow === range.endRow && range.startCol === range.endCol) {
      if (block.selectionLocked) return project
      range = null
    }
    if (block.selectionLocked) return project
    if (!range) {
      return { ...project, blocks: project.blocks.map(item => item.id === block.id ? { ...item, range: null, columns: [] } : item) }
    }
    const workbook = spreadsheet.workbookReader()
    const mappings = workbook
      ? suggestMappingsForWorkbook(workbook, range, block.headerRows, block.activeSheet ?? event.activeSheet)
      : generateColumnMappings(range)
    return {
      ...project,
      blocks: project.blocks.map(item => item.id === block.id ? { ...item, range, activeSheet: event.activeSheet, columns: mappings } : item),
    }
  },
  canvasRanges(project, workbookId) {
    return project.blocks
      .filter(block => block.workbookId === workbookId && block.selectionLocked && block.range)
      .map(block => ({ itemId: block.id, range: block.range!, activeSheet: block.activeSheet, color: '#1677ff' }))
  },
  activeCanvasItems(project) {
    return project.activeRegionId === null && project.activeBlockId ? [project.activeBlockId] : []
  },
  activeColumnItem(project) {
    return project.activeRegionId === null ? project.activeBlockId || null : null
  },
  executionReady: project => project.blocks.some(block => Boolean(block.range)),
  execute(project, workbooks) {
    const validationErrors = validateBlocks(project.blocks)
    if (validationErrors.length) {
      return { diagnostics: validationErrors.map(message => ({ code: 'invalid-range' as const, severity: 'error' as const, message })) }
    }
    const execution = parseProjectWorkbooks(new Map(workbooks), project.blocks, [])
    return {
      data: execution.result.data,
      resultFields: { blocks: execution.result.blocks },
      diagnostics: execution.result.diagnostics,
      snapshots: execution.snapshots,
    }
  },
  applyExecution(project, execution) {
    if (!execution.snapshots?.size) return project
    return {
      ...project,
      blocks: project.blocks.map(block => {
        const snapshot = execution.snapshots?.get(block.id)
        return snapshot ? { ...block, dataSnapshot: snapshot } : block
      }),
    }
  },
  previews(project, result) {
    return new Map(project.blocks.map(block => [block.id, adaptPreviewData(block, result)]))
  },
}
