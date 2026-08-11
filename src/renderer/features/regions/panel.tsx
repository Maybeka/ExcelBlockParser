import type { WorkspaceFeaturePanelProvider } from '../panel/workspacePanel'
import { createDefaultRegion, moveRegion, regionsForWorkbook } from './model'
import { RegionFeaturePanel } from './RegionFeaturePanel'
import { RegionResultView } from './RegionResultView'

export const regionPanelProvider: WorkspaceFeaturePanelProvider = {
  featureId: 'builtin.regions',
  isActive: context => context.project.activeRegionId !== null,
  contribute(context) {
    const regions = regionsForWorkbook(context.project, context.project.activeWorkbookId)
    return {
      id: this.featureId,
      title: 'Region setup',
      summary: `${regions.filter(region => region.range).length} active`,
      ariaLabel: 'Region inspector',
      render: () => (
        <RegionFeaturePanel
          regions={regions}
          activeRegionId={context.project.activeRegionId}
          onAddRegion={() => context.transactProject(project => {
            const region = createDefaultRegion(project, project.activeWorkbookId)
            return { ...project, regions: [...project.regions, region], activeRegionId: region.id, activeBlockId: '' }
          })}
          onDeleteRegion={regionId => context.transactProject(project => ({
            ...project,
            regions: project.regions.filter(region => region.id !== regionId),
            activeRegionId: project.activeRegionId === regionId ? null : project.activeRegionId,
          }))}
          onRegionChange={(regionId, partial) => context.transactProject(project => ({
            ...project,
            regions: project.regions.map(region => region.id === regionId ? { ...region, ...partial } : region),
          }))}
          onActivateRegion={regionId => context.selectProject(project => ({ ...project, activeRegionId: regionId, activeBlockId: '' }))}
          onRangeClick={regionId => {
            const region = context.project.regions.find(item => item.id === regionId)
            if (!region?.range || region.workbookId !== context.loadedWorkbookId) return
            if (region.activeSheet) context.spreadsheet.setActiveSheet(region.activeSheet)
            context.spreadsheet.scrollTo(region.activeSheet, region.range.startRow - 3, region.range.startCol - 1)
            context.selectProject(project => ({ ...project, activeRegionId: regionId, activeBlockId: '' }))
          }}
          onRun={context.run}
        />
      ),
    }
  },
  result(context) {
    const results = context.result.regionResults ?? []
    if (!results.length) return null
    return {
      id: this.featureId,
      label: 'Regions',
      count: results.length,
      render: () => <RegionResultView results={results} />,
    }
  },
  navigation(context) {
    const regions = regionsForWorkbook(context.project, context.project.activeWorkbookId)
    return {
      id: this.featureId,
      label: 'Regions',
      emptyText: 'No regions configured.',
      addAction: {
        label: 'Add Region',
        run: () => context.transactProject(project => {
          const region = createDefaultRegion(project, project.activeWorkbookId)
          return { ...project, regions: [...project.regions, region], activeRegionId: region.id, activeBlockId: '' }
        }),
      },
      items: regions.map((region, index) => ({
        id: region.id,
        label: region.label || `region_${index + 1}`,
        detail: region.range?.a1Notation,
        active: region.id === context.project.activeRegionId,
        locked: region.selectionLocked,
        avatarClassName: 'workspace-region-avatar',
        select: () => context.selectProject(project => ({ ...project, activeRegionId: region.id, activeBlockId: '' })),
        move: direction => context.transactProject(project => moveRegion(project, region.id, direction)),
      })),
    }
  },
}
