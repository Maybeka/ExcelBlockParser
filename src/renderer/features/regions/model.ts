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
  const index = project.regions.findIndex(region => region.id === regionId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= project.regions.length) return project
  const regions = [...project.regions]
  ;[regions[index], regions[target]] = [regions[target], regions[index]]
  return { ...project, regions }
}
