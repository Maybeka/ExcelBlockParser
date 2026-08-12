import type { BlockConfig, ProjectConfig } from '../../types'

let blockCounter = 1

export function createDefaultBlock(lastNum: number, workbookId: string | null = null): BlockConfig {
  const num = lastNum + 1
  return {
    id: `block-${blockCounter++}-${Date.now()}`,
    label: `block_${num}`,
    workbookId,
    range: null,
    activeSheet: null,
    headerRows: [0],
    collapsed: false,
    selectionLocked: false,
    columns: [],
    dataSnapshot: null,
    rowFilter: {
      removeEmptyRows: true,
      emptyCellConditions: { fullyStruck: true },
      condition: null,
    },
  }
}

export function blocksForWorkbook(project: ProjectConfig, workbookId: string | null): BlockConfig[] {
  return project.blocks.filter(block => block.workbookId === workbookId)
}

export function moveBlock(project: ProjectConfig, blockId: string, direction: -1 | 1): ProjectConfig {
  const index = project.blocks.findIndex(block => block.id === blockId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= project.blocks.length) return project
  const blocks = [...project.blocks]
  ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
  return { ...project, blocks }
}

export function removeBlock(project: ProjectConfig, blockId: string): ProjectConfig {
  const removed = project.blocks.find(block => block.id === blockId)
  if (!removed?.workbookId) return project
  const blocks = project.blocks.filter(block => block.id !== blockId)
  const scoped = blocks.filter(block => block.workbookId === removed.workbookId)
  if (scoped.length) return {
    ...project,
    blocks,
    activeBlockId: project.activeBlockId === blockId ? scoped[0].id : project.activeBlockId,
  }
  const fallback = createDefaultBlock(0, removed.workbookId)
  return { ...project, blocks: [...blocks, fallback], activeBlockId: fallback.id }
}
