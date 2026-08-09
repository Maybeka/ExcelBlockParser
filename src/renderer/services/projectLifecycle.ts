import type { BridgeResult } from '../../shared/bridgeResult'
import type { ParseResult, ProjectConfig } from '../types'
import type { WorkbookReader } from './workbook'
import { loadProject, serializeProject } from './serializer'
import { prepareProjectForSave, projectJsonFileName, projectNameFromJsonPath } from './project'

export interface ProjectDocument {
  project: ProjectConfig
  parseResult: ParseResult | null
  filePath: string | null
  migratedFrom?: 1 | 2
}

export type DecodeProjectResult =
  | { status: 'ok'; document: ProjectDocument }
  | { status: 'error'; message: string }

export function decodeProjectDocument(content: string, filePath: string | null = null): DecodeProjectResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { status: 'error', message: 'Invalid config file: failed to parse JSON' }
  }
  const loaded = loadProject(value)
  if (!loaded.project) return { status: 'error', message: loaded.errors.join(' ') }
  const fileName = filePath ? projectNameFromJsonPath(filePath) : null
  return {
    status: 'ok',
    document: {
      project: fileName ? { ...loaded.project.project, name: fileName } : loaded.project.project,
      parseResult: loaded.project.parseResult,
      filePath,
      migratedFrom: loaded.migratedFrom,
    },
  }
}

export interface WorkbookAvailability {
  paths: Record<string, string>
  readers: Map<string, WorkbookReader>
  metadata: Map<string, { sheetNames: string[]; activeSheetName: string | null }>
  availableIds: string[]
  unavailableIds: string[]
}

export async function inspectProjectWorkbookSources(
  project: ProjectConfig,
  readFile: (path: string) => Promise<BridgeResult<ArrayBuffer>>,
  loadWorkbook: (buffer: ArrayBuffer) => Promise<WorkbookReader>,
  isCurrent: () => boolean = () => true,
): Promise<WorkbookAvailability | null> {
  const result: WorkbookAvailability = {
    paths: {}, readers: new Map(), metadata: new Map(), availableIds: [], unavailableIds: [],
  }
  for (const workbook of project.workbooks) {
    if (!isCurrent()) return null
    if (!workbook.sourcePath) { result.unavailableIds.push(workbook.id); continue }
    try {
      const read = await readFile(workbook.sourcePath)
      if (!isCurrent()) return null
      if (read.status !== 'ok') { result.unavailableIds.push(workbook.id); continue }
      const reader = await loadWorkbook(read.value)
      if (!isCurrent()) return null
      const sheetNames = reader.sheetNames()
      result.paths[workbook.id] = workbook.sourcePath
      result.readers.set(workbook.id, reader)
      result.availableIds.push(workbook.id)
      result.metadata.set(workbook.id, {
        sheetNames,
        activeSheetName: workbook.activeSheetName && sheetNames.includes(workbook.activeSheetName)
          ? workbook.activeSheetName : sheetNames[0] ?? null,
      })
    } catch {
      result.unavailableIds.push(workbook.id)
    }
  }
  return result
}

export type SaveProjectResult =
  | { status: 'ok'; project: ProjectConfig; filePath: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface ProjectWriter {
  saveJson(defaultName: string, content: string): Promise<BridgeResult<{ filePath: string }>>
  saveJsonToPath(filePath: string, content: string): Promise<BridgeResult<{ filePath: string }>>
}

export function projectRecoveryContent(project: ProjectConfig, parseResult: ParseResult | null): string {
  return JSON.stringify(serializeProject(project, parseResult))
}

export async function saveProjectDocument(
  writer: ProjectWriter,
  project: ProjectConfig,
  parseResult: ParseResult | null,
  currentPath: string | null,
  saveAs: boolean,
): Promise<SaveProjectResult> {
  let projectForSave = prepareProjectForSave(project)
  const content = JSON.stringify(serializeProject(projectForSave, parseResult), null, 2)
  const write = !saveAs && currentPath
    ? await writer.saveJsonToPath(currentPath, content)
    : await writer.saveJson(projectJsonFileName(projectForSave.name), content)
  if (write.status === 'cancelled') return write
  if (write.status === 'error') return { status: 'error', message: write.error.message }

  const savedName = projectNameFromJsonPath(write.value.filePath)
  if (savedName && savedName !== projectForSave.name) {
    projectForSave = { ...projectForSave, name: savedName }
    const renamed = JSON.stringify(serializeProject(projectForSave, parseResult), null, 2)
    const sync = await writer.saveJsonToPath(write.value.filePath, renamed)
    if (sync.status === 'error') return { status: 'error', message: sync.error.message }
    if (sync.status === 'cancelled') return sync
  }
  return { status: 'ok', project: projectForSave, filePath: write.value.filePath }
}
