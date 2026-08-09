import type { BlockConfig, ProjectConfig, ProjectWorkbook, RegionConfig } from '../types'

export const LEGACY_WORKBOOK_ID = 'workbook-legacy'

export type ProjectBlockFactory = (workbookId: string | null) => BlockConfig

export type ProjectCommandResult =
  | { status: 'changed'; project: ProjectConfig }
  | { status: 'unchanged'; project: ProjectConfig }
  | { status: 'rejected'; project: ProjectConfig; reason: string }

export function applyProjectCommand(project: ProjectConfig, command: (current: ProjectConfig) => ProjectConfig): ProjectCommandResult {
  const next = command(project)
  return next === project ? { status: 'unchanged', project } : { status: 'changed', project: next }
}

export function rejectProjectCommand(project: ProjectConfig, reason: string): ProjectCommandResult {
  return { status: 'rejected', project, reason }
}

export interface LoadedWorkbookMetadata {
  workbookId: string
  fileName: string
  filePath: string
  sheetNames: string[]
  activeSheetName: string | null
}

export function projectNameFromJsonPath(filePath: string): string | null {
  const fileName = filePath.split(/[/\\]/).pop() ?? ''
  const projectName = fileName.replace(/\.json$/i, '').trim()
  return projectName || null
}

export function projectJsonFileName(projectName: string): string {
  const normalized = projectName.trim().replace(/\.json$/i, '') || 'Untitled project'
  return `${normalized}.json`
}

export function createProjectWorkbook(name: string, id = `workbook-${Date.now()}`, sourcePath?: string): ProjectWorkbook {
  return { id, name, ...(sourcePath ? { sourcePath } : {}), sheetNames: [], activeSheetName: null }
}

export function createProject(name = 'Untitled project'): ProjectConfig {
  return {
    id: `project-${Date.now()}`,
    name,
    workbooks: [],
    activeWorkbookId: null,
    blocks: [],
    regions: [],
    activeBlockId: '',
    activeRegionId: null,
    focusMode: 'always-editable',
  }
}

/** Creates the UI's initial unsaved project while keeping block creation feature-owned. */
export function createInitialProject(createBlock: ProjectBlockFactory, name = 'Untitled project'): ProjectConfig {
  const initialBlock = createBlock(null)
  return { ...createProject(name), blocks: [initialBlock], activeBlockId: initialBlock.id }
}

export function belongsToWorkbook(item: { workbookId?: string | null }, workbookId: string | null): boolean {
  return item.workbookId === workbookId || (!item.workbookId && workbookId === LEGACY_WORKBOOK_ID)
}

export function blocksForWorkbook(blocks: BlockConfig[], workbookId: string | null): BlockConfig[] {
  return blocks.filter(block => belongsToWorkbook(block, workbookId))
}

export function regionsForWorkbook(regions: RegionConfig[], workbookId: string | null): RegionConfig[] {
  return regions.filter(region => belongsToWorkbook(region, workbookId))
}

export function withWorkbookId<T extends { workbookId?: string | null }>(items: T[], workbookId: string): T[] {
  return items.map(item => ({ ...item, workbookId: item.workbookId ?? workbookId }))
}

export function addProjectWorkbook(project: ProjectConfig, workbook: ProjectWorkbook): ProjectConfig {
  if (project.workbooks.some(item => item.id === workbook.id || item.name === workbook.name)) return project
  return { ...project, workbooks: [...project.workbooks, workbook] }
}

export function reassignProjectWorkbook(project: ProjectConfig, workbookId: string, name: string, sourcePath: string): ProjectConfig {
  if (!project.workbooks.some(workbook => workbook.id === workbookId)) return project
  return {
    ...project,
    workbooks: project.workbooks.map(workbook => workbook.id === workbookId ? { ...workbook, name, sourcePath } : workbook),
  }
}

export function setActiveWorkbookSheet(project: ProjectConfig, sheetName: string | null): ProjectConfig {
  if (!project.activeWorkbookId) return project
  return {
    ...project,
    workbooks: project.workbooks.map(workbook => workbook.id === project.activeWorkbookId
      ? { ...workbook, activeSheetName: sheetName }
      : workbook),
  }
}

export function activateProjectWorkbook(project: ProjectConfig, workbookId: string, sheetName?: string): ProjectConfig {
  if (!project.workbooks.some(workbook => workbook.id === workbookId)) return project
  const scopedBlocks = blocksForWorkbook(project.blocks, workbookId)
  return {
    ...project,
    workbooks: sheetName === undefined
      ? project.workbooks
      : project.workbooks.map(workbook => workbook.id === workbookId ? { ...workbook, activeSheetName: sheetName } : workbook),
    activeWorkbookId: workbookId,
    activeBlockId: scopedBlocks[0]?.id ?? '',
    activeRegionId: null,
  }
}

export function recordProjectWorkbookLoaded(
  project: ProjectConfig,
  metadata: LoadedWorkbookMetadata,
  createBlock: ProjectBlockFactory,
): ProjectConfig {
  const workbook = project.workbooks.find(item => item.id === metadata.workbookId)
  if (!workbook) return project

  const nextWorkbook: ProjectWorkbook = {
    ...workbook,
    name: workbook.id === LEGACY_WORKBOOK_ID ? metadata.fileName : workbook.name,
    sourcePath: metadata.filePath,
    sheetNames: metadata.sheetNames,
    activeSheetName: metadata.activeSheetName,
  }
  const workbooks = project.workbooks.map(item => item.id === workbook.id ? nextWorkbook : item)
  const scoped = blocksForWorkbook(project.blocks, workbook.id)
  if (scoped.length) {
    return { ...project, workbooks, activeWorkbookId: workbook.id, activeBlockId: scoped[0].id, activeRegionId: null }
  }

  const draftBlocks = project.blocks.filter(block => block.workbookId === null)
  if (draftBlocks.length) {
    return {
      ...project,
      workbooks,
      blocks: project.blocks.map(block => block.workbookId === null ? { ...block, workbookId: workbook.id } : block),
      activeWorkbookId: workbook.id,
      activeBlockId: draftBlocks[0].id,
      activeRegionId: null,
    }
  }

  const freshBlock = createBlock(workbook.id)
  return {
    ...project,
    workbooks,
    blocks: [...project.blocks, freshBlock],
    activeWorkbookId: workbook.id,
    activeBlockId: freshBlock.id,
    activeRegionId: null,
  }
}

export function removeProjectWorkbook(
  project: ProjectConfig,
  workbookId: string,
  replacementWorkbookId: string | null = null,
): ProjectConfig {
  if (!project.workbooks.some(workbook => workbook.id === workbookId)) return project
  const workbooks = project.workbooks.filter(workbook => workbook.id !== workbookId)
  const validReplacement = replacementWorkbookId && workbooks.some(workbook => workbook.id === replacementWorkbookId)
    ? replacementWorkbookId
    : null
  const nextActiveWorkbookId = project.activeWorkbookId === workbookId ? validReplacement : project.activeWorkbookId
  const blocks = project.blocks.filter(block => block.workbookId !== workbookId)
  const regions = project.regions.filter(region => region.workbookId !== workbookId)
  const activeBlockSurvives = blocks.some(block => block.id === project.activeBlockId && block.workbookId === nextActiveWorkbookId)
  const activeRegionSurvives = regions.some(region => region.id === project.activeRegionId && region.workbookId === nextActiveWorkbookId)
  return {
    ...project,
    workbooks,
    blocks,
    regions,
    activeWorkbookId: nextActiveWorkbookId,
    activeBlockId: activeBlockSurvives
      ? project.activeBlockId
      : nextActiveWorkbookId ? blocksForWorkbook(blocks, nextActiveWorkbookId)[0]?.id ?? '' : '',
    activeRegionId: activeRegionSurvives ? project.activeRegionId : null,
  }
}

export function prepareProjectForSave(project: ProjectConfig): ProjectConfig {
  const blocks = project.blocks.filter(block => Boolean(block.workbookId))
  const regions = project.regions.filter(region => Boolean(region.workbookId))
  return {
    ...project,
    blocks,
    regions,
    activeBlockId: blocks.some(block => block.id === project.activeBlockId) ? project.activeBlockId : blocks[0]?.id ?? '',
    activeRegionId: regions.some(region => region.id === project.activeRegionId) ? project.activeRegionId : null,
  }
}

export function removeBlockForWorkbook(
  blocks: BlockConfig[],
  blockId: string,
  workbookId: string,
  createFallback: () => BlockConfig,
): { blocks: BlockConfig[]; activeBlockId: string } {
  const remaining = blocks.filter(block => block.id !== blockId)
  const scoped = remaining.filter(block => block.workbookId === workbookId)
  if (scoped.length) return { blocks: remaining, activeBlockId: scoped[0].id }
  const fallback = createFallback()
  return { blocks: [...remaining, fallback], activeBlockId: fallback.id }
}

export function moveItemWithinWorkbook<T extends { id: string; workbookId?: string | null }>(
  items: T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const item = items.find(candidate => candidate.id === id)
  if (!item) return items
  const scopedIndices = items
    .map((candidate, index) => candidate.workbookId === item.workbookId ? index : -1)
    .filter(index => index >= 0)
  const scopedIndex = scopedIndices.findIndex(index => items[index].id === id)
  const targetScopedIndex = scopedIndex + direction
  if (scopedIndex < 0 || targetScopedIndex < 0 || targetScopedIndex >= scopedIndices.length) return items
  const next = [...items]
  const targetIndex = scopedIndices[targetScopedIndex]
  const currentIndex = scopedIndices[scopedIndex]
  ;[next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]]
  return next
}
