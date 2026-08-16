import type { ProjectConfig, ProjectWorkbook } from '../types'
import type { BuiltInFeatureRegistry, WorkbookLoadedEvent } from '../features/core/projectFeature'
import { createPythonPackage } from './pythonPackage'

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
    pythonScript: createPythonPackage(),
  }
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

export function activateProjectWorkbook(project: ProjectConfig, workbookId: string, features: BuiltInFeatureRegistry, sheetName?: string): ProjectConfig {
  if (!project.workbooks.some(workbook => workbook.id === workbookId)) return project
  const activated = {
    ...project,
    workbooks: sheetName === undefined
      ? project.workbooks
      : project.workbooks.map(workbook => workbook.id === workbookId ? { ...workbook, activeSheetName: sheetName } : workbook),
    activeWorkbookId: workbookId,
  }
  return features.activateWorkbook(activated, workbookId)
}

export function recordProjectWorkbookLoaded(
  project: ProjectConfig,
  metadata: LoadedWorkbookMetadata,
  features: BuiltInFeatureRegistry,
): ProjectConfig {
  const workbook = project.workbooks.find(item => item.id === metadata.workbookId)
  if (!workbook) return project

  const nextWorkbook: ProjectWorkbook = { ...workbook, sourcePath: metadata.filePath, sheetNames: metadata.sheetNames, activeSheetName: metadata.activeSheetName }
  const workbooks = project.workbooks.map(item => item.id === workbook.id ? nextWorkbook : item)
  const event: WorkbookLoadedEvent = metadata
  return features.workbookLoaded({ ...project, workbooks, activeWorkbookId: workbook.id }, event)
}

export function removeProjectWorkbook(
  project: ProjectConfig,
  workbookId: string,
  features: BuiltInFeatureRegistry,
  replacementWorkbookId: string | null = null,
): ProjectConfig {
  if (!project.workbooks.some(workbook => workbook.id === workbookId)) return project
  const workbooks = project.workbooks.filter(workbook => workbook.id !== workbookId)
  const validReplacement = replacementWorkbookId && workbooks.some(workbook => workbook.id === replacementWorkbookId)
    ? replacementWorkbookId
    : null
  const nextActiveWorkbookId = project.activeWorkbookId === workbookId ? validReplacement : project.activeWorkbookId
  const core = {
    ...project,
    workbooks,
    activeWorkbookId: nextActiveWorkbookId,
  }
  const removed = features.removeWorkbook(core, workbookId)
  const activeWorkbookWasRemoved = project.activeWorkbookId === workbookId
  return activeWorkbookWasRemoved && nextActiveWorkbookId
    ? features.activateWorkbook(removed, nextActiveWorkbookId)
    : removed
}
