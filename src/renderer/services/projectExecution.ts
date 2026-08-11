import type { BridgeResult } from '../../shared/bridgeResult'
import type { ParseResult, PreviewData, ProjectConfig } from '../types'
import type { WorkbookReader } from './workbook'
import { builtInFeatureRegistry } from '../features/builtinRegistry'

export type ProjectExecutionResult =
  | { status: 'stale' }
  | { status: 'complete'; result: ParseResult; project: ProjectConfig; previews: Map<string, PreviewData> }

export async function executeProject(
  project: ProjectConfig,
  paths: Readonly<Record<string, string>>,
  readFile: (path: string) => Promise<BridgeResult<ArrayBuffer>>,
  loadWorkbook: (buffer: ArrayBuffer) => Promise<WorkbookReader>,
  isCurrent: () => boolean = () => true,
  signal: AbortSignal = new AbortController().signal,
): Promise<ProjectExecutionResult> {
  const readers = new Map<string, WorkbookReader>()
  for (const workbook of project.workbooks) {
    if (!isCurrent() || signal.aborted) return { status: 'stale' }
    const path = paths[workbook.id]
    if (!path) continue
    const read = await readFile(path)
    if (!isCurrent() || signal.aborted) return { status: 'stale' }
    if (read.status === 'ok') readers.set(workbook.id, await loadWorkbook(read.value))
  }
  if (!isCurrent() || signal.aborted) return { status: 'stale' }
  const execution = await builtInFeatureRegistry.execute(project, readers, signal)
  if (!execution || !isCurrent() || signal.aborted) return { status: 'stale' }
  const nextProject = builtInFeatureRegistry.applyExecution(project, execution)
  const previews = builtInFeatureRegistry.previews(nextProject, execution.result)
  return { status: 'complete', result: execution.result, project: nextProject, previews }
}
