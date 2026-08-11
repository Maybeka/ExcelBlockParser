import { lazy } from 'react'
import { ConfigPanel } from '../../components/ConfigPanel'
import type { WorkspaceFeaturePanelProvider } from '../panel/workspacePanel'
import { blocksForWorkbook, createDefaultBlock, moveBlock, removeBlock } from './model'

const ExtractionResultView = lazy(async () => ({
  default: (await import('./ExtractionResultView')).ExtractionResultView,
}))

export const extractionPanelProvider: WorkspaceFeaturePanelProvider = {
  featureId: 'builtin.extraction',
  isActive: context => context.project.activeRegionId === null,
  contribute(context) {
    const { project } = context
    const blocks = blocksForWorkbook(project, project.activeWorkbookId)
    return {
      id: this.featureId,
      title: 'Extraction setup',
      summary: `${blocks.filter(block => block.range).length} active`,
      ariaLabel: 'Extraction inspector',
      render: () => (
        <ConfigPanel
          spreadsheet={context.spreadsheet}
          blocks={blocks}
          activeBlockId={project.activeBlockId}
          activeColIndex={context.activeColIndex}
          focusMode={project.focusMode}
          parseResult={context.parseResult}
          onActivateBlock={blockId => context.selectProject(current => {
            const block = current.blocks.find(item => item.id === blockId)
            if (block?.workbookId === context.loadedWorkbookId && block.activeSheet) context.spreadsheet.setActiveSheet(block.activeSheet)
            return { ...current, activeBlockId: blockId, activeRegionId: null }
          })}
          onBlockChange={(blockId, partial) => context.transactProject(current => ({
            ...current,
            blocks: current.blocks.map(block => block.id === blockId ? { ...block, ...partial } : block),
          }))}
          onAddBlock={() => context.transactProject(current => {
            const max = current.blocks.reduce((value, block) => {
              const match = block.label.match(/^block_(\d+)$/)
              return match ? Math.max(value, Number(match[1])) : value
            }, 0)
            const block = createDefaultBlock(max, current.activeWorkbookId)
            return { ...current, blocks: [...current.blocks, block], activeBlockId: block.id, activeRegionId: null }
          })}
          onDeleteBlock={blockId => context.transactProject(current => removeBlock(current, blockId))}
          onFocusModeChange={focusMode => context.transactProject(current => ({ ...current, focusMode }))}
          onColumnFocus={context.setActiveColumn}
          onParse={context.run}
          onReconcilingChange={blockId => {
            const block = context.project.blocks.find(item => item.id === blockId)
            context.setReconciliationItem(block ? { id: block.id, range: block.range, activeSheet: block.activeSheet } : null)
          }}
          onReselectRange={context.takeReselectedRange}
          onPreviewSheet={context.setPreviewSheet}
        />
      ),
    }
  },
  result(context) {
    const previews = new Map([...context.previews].filter(([id]) => context.project.blocks.some(block => block.id === id)))
    if (!previews.size) return null
    return {
      id: this.featureId,
      label: 'Blocks',
      count: previews.size,
      render: () => <ExtractionResultView project={context.project} previews={previews} close={context.close} />,
    }
  },
  navigation(context) {
    const blocks = blocksForWorkbook(context.project, context.project.activeWorkbookId)
    return {
      id: this.featureId,
      label: 'Extractors',
      emptyText: 'No extractors configured.',
      items: blocks.map((block, index) => ({
        id: block.id,
        label: block.label || `block_${index + 1}`,
        detail: block.range?.a1Notation,
        active: block.id === context.project.activeBlockId,
        locked: block.selectionLocked,
        avatarClassName: 'workspace-extractor-avatar',
        select: () => context.selectProject(project => ({ ...project, activeBlockId: block.id, activeRegionId: null })),
        move: direction => context.transactProject(project => moveBlock(project, block.id, direction)),
      })),
    }
  },
}
