import type { BridgeResult } from '../../shared/bridgeResult'
import type { ParseResult, PreviewData, ProjectConfig } from '../types'
import { adaptPreviewData } from './previewDataAdapter'
import { parseProjectWorkbooks } from './extraction'
import type { WorkbookReader } from './workbook'

export type ProjectExecutionResult =
  | { status: 'stale' }
  | { status: 'complete'; result: ParseResult; project: ProjectConfig; previews: Map<string, PreviewData> }

export async function executeProject(
  project: ProjectConfig,
  paths: Readonly<Record<string, string>>,
  readFile: (path: string) => Promise<BridgeResult<ArrayBuffer>>,
  loadWorkbook: (buffer: ArrayBuffer) => Promise<WorkbookReader>,
  isCurrent: () => boolean = () => true,
): Promise<ProjectExecutionResult> {
  const readers = new Map<string, WorkbookReader>()
  for (const workbook of project.workbooks) {
    if (!isCurrent()) return { status: 'stale' }
    const path = paths[workbook.id]
    if (!path) continue
    const read = await readFile(path)
    if (!isCurrent()) return { status: 'stale' }
    if (read.status === 'ok') readers.set(workbook.id, await loadWorkbook(read.value))
  }
  if (!isCurrent()) return { status: 'stale' }
  const execution = parseProjectWorkbooks(readers, project.blocks, project.regions)
  const blocks = project.blocks.map(block => {
    const snapshot = execution.snapshots.get(block.id)
    return snapshot ? { ...block, dataSnapshot: snapshot } : block
  })
  const nextProject = { ...project, blocks }
  const previews = new Map<string, PreviewData>()
  for (const block of blocks) previews.set(block.id, adaptPreviewData(block, execution.result))
  return { status: 'complete', result: execution.result, project: nextProject, previews }
}
