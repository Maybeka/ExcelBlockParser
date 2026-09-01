import type { BridgeResult } from '../../shared/bridgeResult'
import type { ParseResult, ProjectConfig } from '../types'
import type { WorkbookReader } from './workbook'
import { loadProject, serializeProject } from './serializer'
import { projectJsonFileName, projectNameFromJsonPath } from './project'
import { parseJsonDocument } from './jsonValidation'

export interface ProjectDocument {
  project: ProjectConfig
  parseResult: ParseResult | null
  filePath: string | null
}

export type DecodeProjectResult =
  | { status: 'ok'; document: ProjectDocument }
  | { status: 'error'; message: string }

export const MAX_PROJECT_JSON_BYTES = 25 * 1024 * 1024

export function decodeProjectDocument(content: string, filePath: string | null = null): DecodeProjectResult {
  if (new TextEncoder().encode(content).byteLength > MAX_PROJECT_JSON_BYTES) {
    return { status: 'error', message: 'Invalid project file: exceeds the 25 MB limit.' }
  }
  const parsed = parseJsonDocument(content)
  if (parsed.error) return { status: 'error', message: `Invalid config file: ${parsed.error}` }
  const value = parsed.value
  const loaded = loadProject(value)
  if (!loaded.project) return { status: 'error', message: loaded.errors.join('\n') }
  const fileName = filePath ? projectNameFromJsonPath(filePath) : null
  return {
    status: 'ok',
    document: {
      project: fileName ? { ...loaded.project.project, name: fileName } : loaded.project.project,
      parseResult: loaded.project.parseResult,
      filePath,
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

interface ParsedPath {
  root: string
  segments: string[]
  windows: boolean
}

function parseAbsolutePath(value: string): ParsedPath | null {
  const normalized = value.replace(/\\/g, '/')
  const drive = normalized.match(/^([A-Za-z]:)\/(.*)$/)
  if (drive) return { root: drive[1].toLowerCase(), segments: drive[2].split('/').filter(Boolean), windows: true }
  const unc = normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/)
  if (unc) return { root: `//${unc[1].toLowerCase()}/${unc[2].toLowerCase()}`, segments: (unc[3] ?? '').split('/').filter(Boolean), windows: true }
  if (normalized.startsWith('/')) return { root: '/', segments: normalized.slice(1).split('/').filter(Boolean), windows: false }
  return null
}

function normalizeSegments(segments: string[]): string[] {
  return segments.reduce<string[]>((result, segment) => {
    if (!segment || segment === '.') return result
    if (segment === '..') result.pop()
    else result.push(segment)
    return result
  }, [])
}

function resolveWorkbookSourcePath(sourcePath: string, projectFilePath: string | null): string {
  if (parseAbsolutePath(sourcePath) || !projectFilePath) return sourcePath
  const project = parseAbsolutePath(projectFilePath)
  if (!project) return sourcePath
  const directory = project.segments.slice(0, -1)
  const segments = normalizeSegments([...directory, ...sourcePath.replace(/\\/g, '/').split('/')])
  if (project.root === '/') return `/${segments.join('/')}`
  return project.root.startsWith('//')
    ? `${project.root}/${segments.join('/')}`
    : `${project.root.toUpperCase()}/${segments.join('/')}`
}

function relativeWorkbookSourcePath(sourcePath: string, projectFilePath: string): string {
  const source = parseAbsolutePath(sourcePath)
  const project = parseAbsolutePath(projectFilePath)
  if (!source || !project || source.root !== project.root || source.windows !== project.windows) return sourcePath
  const base = normalizeSegments(project.segments.slice(0, -1))
  const target = normalizeSegments(source.segments)
  let common = 0
  while (common < base.length && common < target.length) {
    const left = source.windows ? base[common].toLowerCase() : base[common]
    const right = source.windows ? target[common].toLowerCase() : target[common]
    if (left !== right) break
    common += 1
  }
  return [...base.slice(common).map(() => '..'), ...target.slice(common)].join('/') || '.'
}

function projectWithPersistedWorkbookPaths(
  project: ProjectConfig,
  runtimePaths: Readonly<Record<string, string>>,
  currentProjectPath: string | null,
  destinationProjectPath: string,
): ProjectConfig {
  return {
    ...project,
    workbooks: project.workbooks.map(workbook => {
      const sourcePath = runtimePaths[workbook.id] ?? workbook.sourcePath
      if (!sourcePath) return workbook
      const absolutePath = resolveWorkbookSourcePath(sourcePath, currentProjectPath)
      return { ...workbook, sourcePath: relativeWorkbookSourcePath(absolutePath, destinationProjectPath) }
    }),
  }
}

function recoverySourcePath(sourcePath: string, projectFilePath: string | null): string {
  if (!projectFilePath || /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(sourcePath)) return sourcePath
  const slash = Math.max(projectFilePath.lastIndexOf('/'), projectFilePath.lastIndexOf('\\'))
  if (slash < 0) return sourcePath
  return `${projectFilePath.slice(0, slash + 1)}${sourcePath}`
}

export function projectRecoveryContent(project: ProjectConfig, parseResult: ParseResult | null, projectFilePath: string | null = null): string {
  const recoveryProject = {
    ...project,
    workbooks: project.workbooks.map(workbook => workbook.sourcePath
      ? { ...workbook, sourcePath: recoverySourcePath(workbook.sourcePath, projectFilePath) }
      : workbook),
  }
  return JSON.stringify(serializeProject(recoveryProject, parseResult))
}

export async function saveProjectDocument(
  writer: ProjectWriter,
  project: ProjectConfig,
  parseResult: ParseResult | null,
  currentPath: string | null,
  saveAs: boolean,
  prepareProject: (project: ProjectConfig) => ProjectConfig,
  runtimePaths: Readonly<Record<string, string>> = {},
): Promise<SaveProjectResult> {
  let projectForSave = prepareProject(project)
  if (!saveAs && currentPath) {
    projectForSave = projectWithPersistedWorkbookPaths(projectForSave, runtimePaths, currentPath, currentPath)
  }
  const content = JSON.stringify(serializeProject(projectForSave, parseResult), null, 2)
  const write = !saveAs && currentPath
    ? await writer.saveJsonToPath(currentPath, content)
    : await writer.saveJson(projectJsonFileName(projectForSave.name), content)
  if (write.status === 'cancelled') return write
  if (write.status === 'error') return { status: 'error', message: write.error.message }

  projectForSave = projectWithPersistedWorkbookPaths(projectForSave, runtimePaths, currentPath, write.value.filePath)
  const savedName = projectNameFromJsonPath(write.value.filePath)
  if (savedName) projectForSave = { ...projectForSave, name: savedName }
  const persistedContent = JSON.stringify(serializeProject(projectForSave, parseResult), null, 2)
  if (persistedContent !== content) {
    const sync = await writer.saveJsonToPath(write.value.filePath, persistedContent)
    if (sync.status === 'error') return { status: 'error', message: sync.error.message }
    if (sync.status === 'cancelled') return sync
  }
  return { status: 'ok', project: projectForSave, filePath: write.value.filePath }
}
