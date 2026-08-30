import type { WorkspaceFeaturePanelProvider } from '../panel/workspacePanel'
import { createDefaultRegion, moveRegion } from './model'
import { ExtractionHeaderActions } from '../extraction/ExtractionHeaderActions'
import { RegionFeaturePanel } from './RegionFeaturePanel'
import { RegionResultView } from './RegionResultView'
import { translate } from '../../i18n'

export const regionPanelProvider: WorkspaceFeaturePanelProvider = {
  featureId: 'builtin.regions',
  isActive: context => context.project.activeRegionId !== null,
  contribute(context) {
    const regions = context.project.regions
    const t = context.t ?? ((key: string, values?: Record<string, string | number>) => translate('en-US', key, values))
    const activeRegions = regions.filter(region => region.id === context.project.activeRegionId)
    return {
      id: this.featureId,
      title: t('extract.title'),
      summary: t('extract.blocksRegions', { blocks: context.project.blocks.length, regions: regions.length }),
      ariaLabel: t('extract.title'),
      headerActions: <ExtractionHeaderActions context={context} />,
      render: () => (
        <RegionFeaturePanel
          regions={activeRegions}
          activeRegionId={context.project.activeRegionId}
          onDeleteRegion={regionId => context.transactProject(project => ({
            ...project,
            regions: project.regions.filter(region => region.id !== regionId),
            activeRegionId: project.activeRegionId === regionId ? null : project.activeRegionId,
          }))}
          onRegionChange={(regionId, partial) => context.transactProject(project => ({
            ...project,
            regions: project.regions.map(region => region.id === regionId ? { ...region, ...partial } : region),
          }))}
          onActivateRegion={regionId => {
            const region = context.project.regions.find(item => item.id === regionId)
            if (!region) return
            if (region.workbookId && region.workbookId !== context.loadedWorkbookId) context.activateWorkbook(region.workbookId, region.activeSheet ?? undefined)
            else if (region.activeSheet) context.spreadsheet.setActiveSheet(region.activeSheet)
            context.selectProject(project => ({ ...project, activeRegionId: regionId, activeBlockId: '' }))
          }}
          onRangeClick={regionId => {
            const region = context.project.regions.find(item => item.id === regionId)
            if (!region?.range) return
            if (region.workbookId && region.workbookId !== context.loadedWorkbookId) context.activateWorkbook(region.workbookId, region.activeSheet ?? undefined)
            else if (region.activeSheet) context.spreadsheet.setActiveSheet(region.activeSheet)
            context.focusRange(region.workbookId, region.activeSheet, region.range)
            context.selectProject(project => ({ ...project, activeRegionId: regionId, activeBlockId: '' }))
          }}
        />
      ),
    }
  },
  result(context) {
    const results = context.result.regionResults ?? []
    if (!results.length) return null
    return {
      id: this.featureId,
      label: (context.t ?? ((key: string) => translate('en-US', key)))('workspace.regions'),
      count: results.length,
      render: () => <RegionResultView results={results} />,
    }
  },
  navigation(context) {
    const regions = context.project.regions
    return {
      id: this.featureId,
      label: (context.t ?? ((key: string) => translate('en-US', key)))('workspace.regions'),
      emptyText: (context.t ?? ((key: string) => translate('en-US', key)))('workspace.noRegions'),
      items: regions.map((region, index) => ({
        id: region.id,
        label: region.label || `region_${index + 1}`,
        detail: [
          context.project.workbooks.find(workbook => workbook.id === region.workbookId)?.name,
          region.range ? `${region.activeSheet ? `${region.activeSheet}!` : ''}${region.range.a1Notation}` : null,
        ].filter(Boolean).join(' · '),
        active: region.id === context.project.activeRegionId,
        locked: region.selectionLocked,
        avatarClassName: 'workspace-region-avatar',
        select: () => {
          if (region.workbookId) context.activateWorkbook(region.workbookId, region.activeSheet ?? undefined)
          context.focusRange(region.workbookId, region.activeSheet, region.range)
          context.selectProject(project => ({ ...project, activeRegionId: region.id, activeBlockId: '' }))
        },
        move: direction => context.transactProject(project => moveRegion(project, region.id, direction)),
      })),
    }
  },
}
