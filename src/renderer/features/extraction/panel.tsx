import { lazy } from 'react'
import { ConfigPanel } from '../../components/ConfigPanel'
import type { WorkspaceFeaturePanelProvider } from '../panel/workspacePanel'
import { createDefaultBlock, moveBlock, removeBlock } from './model'
import { ExtractionHeaderActions } from './ExtractionHeaderActions'
import { translate } from '../../i18n'

const ExtractionResultView = lazy(async () => ({
  default: (await import('./ExtractionResultView')).ExtractionResultView,
}))

export const extractionPanelProvider: WorkspaceFeaturePanelProvider = {
  featureId: 'builtin.extraction',
  isActive: context => context.project.activeRegionId === null,
  contribute(context) {
    const { project } = context
    const t = context.t ?? ((key: string, values?: Record<string, string | number>) => translate('en-US', key, values))
    const blocks = project.blocks
    const activeBlocks = blocks.filter(block => block.id === project.activeBlockId)
    return {
      id: this.featureId,
      title: t('extract.title'),
      summary: t('extract.blocksRegions', { blocks: blocks.length, regions: project.regions.length }),
      ariaLabel: t('extract.title'),
      headerActions: <ExtractionHeaderActions context={context} />,
      render: () => (
        <ConfigPanel
          spreadsheet={context.spreadsheet}
          workbooks={project.workbooks}
          loadedWorkbookId={context.loadedWorkbookId}
          blocks={activeBlocks}
          activeBlockId={project.activeBlockId}
          activeColIndex={context.activeColIndex}
          focusMode={project.focusMode}
          parseResult={context.parseResult}
          onActivateBlock={blockId => {
            const block = context.project.blocks.find(item => item.id === blockId)
            if (!block) return
            if (block.workbookId && block.workbookId !== context.loadedWorkbookId) context.activateWorkbook(block.workbookId, block.activeSheet ?? undefined)
            else if (block.activeSheet) context.spreadsheet.setActiveSheet(block.activeSheet)
            context.selectProject(current => ({ ...current, activeBlockId: blockId, activeRegionId: null }))
          }}
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
          onReconcilingChange={blockId => {
            const block = context.project.blocks.find(item => item.id === blockId)
            context.setReconciliationItem(block ? { id: block.id, workbookId: block.workbookId, range: block.range, activeSheet: block.activeSheet } : null)
          }}
          onReselectRange={context.takeReselectedRange}
          onPreviewSheet={context.setPreviewSheet}
          onFocusRange={blockId => {
            const block = context.project.blocks.find(item => item.id === blockId)
            if (block) context.focusRange(block.workbookId, block.activeSheet, block.range)
          }}
          onFocusRangeReset={source => {
            if (!source.workbookId || !source.range) return
            context.activateWorkbook(source.workbookId, source.activeSheet ?? undefined)
            context.focusRange(source.workbookId, source.activeSheet, source.range)
          }}
          onActivateWorkbook={context.activateWorkbook}
          canAddBlock={Boolean(project.activeWorkbookId)}
        />
      ),
    }
  },
  result(context) {
    const previews = new Map([...context.previews].filter(([id]) => context.project.blocks.some(block => block.id === id)))
    if (!previews.size) return null
    return {
      id: this.featureId,
      label: (context.t ?? ((key: string) => translate('en-US', key)))('workspace.blocks'),
      count: previews.size,
      render: () => <ExtractionResultView project={context.project} previews={previews} />,
    }
  },
  navigation(context) {
    const blocks = context.project.blocks
    return {
      id: this.featureId,
      label: (context.t ?? ((key: string) => translate('en-US', key)))('workspace.blocks'),
      emptyText: (context.t ?? ((key: string) => translate('en-US', key)))('workspace.noBlocks'),
      items: blocks.map((block, index) => ({
        id: block.id,
        label: block.label || `block_${index + 1}`,
        detail: [
          context.project.workbooks.find(workbook => workbook.id === block.workbookId)?.name,
          block.range ? `${block.activeSheet ? `${block.activeSheet}!` : ''}${block.range.a1Notation}` : null,
        ].filter(Boolean).join(' · '),
        active: block.id === context.project.activeBlockId,
        locked: block.selectionLocked,
        avatarClassName: 'workspace-extractor-avatar',
        select: () => {
          if (block.workbookId) context.activateWorkbook(block.workbookId, block.activeSheet ?? undefined)
          context.focusRange(block.workbookId, block.activeSheet, block.range)
          context.selectProject(project => ({ ...project, activeBlockId: block.id, activeRegionId: null }))
        },
        move: direction => context.transactProject(project => moveBlock(project, block.id, direction)),
      })),
    }
  },
}
