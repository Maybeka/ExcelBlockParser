import type { BlockConfig, ProjectConfig, ProjectWorkbook, RegionConfig } from '../types'

export const LEGACY_WORKBOOK_ID = 'workbook-legacy'

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
