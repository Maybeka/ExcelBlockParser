import type { ProjectConfig, RegionConfig } from '../../types'

export function regionsForWorkbook(project: ProjectConfig, workbookId: string | null): RegionConfig[] {
  return project.regions.filter(region => region.workbookId === workbookId)
}

export function createDefaultRegion(project: ProjectConfig, workbookId: string | null): RegionConfig {
  return {
    id: `region-${Date.now()}`,
    label: `region_${project.regions.length + 1}`,
    workbookId,
    range: null,
    activeSheet: null,
    splitRules: [{ type: 'emptyRow' }],
    blocks: [],
    collapsed: false,
    selectionLocked: false,
  }
}

export function moveRegion(project: ProjectConfig, regionId: string, direction: -1 | 1): ProjectConfig {
  const item = project.regions.find(region => region.id === regionId)
  if (!item) return project
  const scoped = project.regions.map((region, index) => region.workbookId === item.workbookId ? index : -1).filter(index => index >= 0)
  const index = scoped.findIndex(candidate => project.regions[candidate].id === regionId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= scoped.length) return project
  const regions = [...project.regions]
  ;[regions[scoped[index]], regions[scoped[target]]] = [regions[scoped[target]], regions[scoped[index]]]
  return { ...project, regions }
}
