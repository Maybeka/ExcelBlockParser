import { describe, expect, it, vi } from 'vitest'
import { bridgeCancelled, bridgeError, bridgeOk } from '../../shared/bridgeResult'
import type { ProjectConfig } from '../types'
import { decodeProjectDocument, inspectProjectWorkbookSources, MAX_PROJECT_JSON_BYTES, saveProjectDocument } from '../services/projectLifecycle'
import { serializeProject } from '../services/serializer'
import type { WorkbookReader } from '../services/workbook'
import { builtInFeatureRegistry } from '../features/builtinRegistry'

const project: ProjectConfig = {
  id: 'project-1', name: 'Demo', workbooks: [
    { id: 'a', name: 'a.xlsx', sourcePath: '/a.xlsx', sheetNames: ['Old'], activeSheetName: 'Old' },
    { id: 'b', name: 'b.xlsx', sourcePath: '/missing.xlsx', sheetNames: [], activeSheetName: null },
  ], activeWorkbookId: 'a', blocks: [], regions: [], activeBlockId: '', activeRegionId: null, focusMode: 'always-editable',
}
const reader: WorkbookReader = { sheetNames: () => ['Sheet1'], getActiveSheet: () => null, getSheet: () => null }

describe('project lifecycle coordinator', () => {
  it('rejects malformed JSON without producing a document', () => {
    expect(decodeProjectDocument('{')).toEqual({ status: 'error', message: 'Invalid config file: failed to parse JSON' })
  })
  it('rejects oversized project JSON before parsing', () => {
    const oversized = `{"padding":"${'x'.repeat(MAX_PROJECT_JSON_BYTES)}"}`
    expect(decodeProjectDocument(oversized)).toEqual({ status: 'error', message: 'Invalid project file: exceeds the 25 MB limit.' })
  })
  it('uses the opened JSON filename as the project name', () => {
    const decoded = decodeProjectDocument(JSON.stringify(serializeProject(project, null)), '/tmp/Renamed.json')
    expect(decoded.status).toBe('ok')
    if (decoded.status === 'ok') expect(decoded.document.project.name).toBe('Renamed')
  })
  it('resolves partial workbook availability without changing the project', async () => {
    const result = await inspectProjectWorkbookSources(project, async path => path === '/a.xlsx' ? bridgeOk(new ArrayBuffer(1)) : bridgeError('not found'), async () => reader)
    expect(result?.availableIds).toEqual(['a'])
    expect(result?.unavailableIds).toEqual(['b'])
    expect(result?.metadata.get('a')).toEqual({ sheetNames: ['Sheet1'], activeSheetName: 'Sheet1' })
    expect(project.workbooks[0].sheetNames).toEqual(['Old'])
  })
  it('returns null when an in-flight open becomes stale', async () => {
    let current = true
    const result = await inspectProjectWorkbookSources(project, async () => { current = false; return bridgeOk(new ArrayBuffer(1)) }, async () => reader, () => current)
    expect(result).toBeNull()
  })
  it('preserves state on cancelled and failed saves', async () => {
    const cancelled = await saveProjectDocument({ saveJson: async () => bridgeCancelled(), saveJsonToPath: async () => bridgeCancelled() }, project, null, null, false, current => builtInFeatureRegistry.prepareForSave(current))
    expect(cancelled.status).toBe('cancelled')
    const failed = await saveProjectDocument({ saveJson: async () => bridgeError('disk full'), saveJsonToPath: async () => bridgeError('disk full') }, project, null, null, false, current => builtInFeatureRegistry.prepareForSave(current))
    expect(failed).toEqual({ status: 'error', message: 'disk full' })
    expect(project.name).toBe('Demo')
  })
  it('renames and rewrites a Save As document to match its selected path', async () => {
    const writes: string[] = []
    const saveJsonToPath = vi.fn(async (_path: string, content: string) => { writes.push(content); return bridgeOk({ filePath: '/tmp/New Name.json' }) })
    const result = await saveProjectDocument({ saveJson: async (_name, content) => { writes.push(content); return bridgeOk({ filePath: '/tmp/New Name.json' }) }, saveJsonToPath }, project, null, null, true, current => builtInFeatureRegistry.prepareForSave(current))
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.project.name).toBe('New Name')
    expect(saveJsonToPath).toHaveBeenCalledOnce()
    expect(JSON.parse(writes[1]).project.name).toBe('New Name')
  })
  it('persists workbook paths relative to the selected project location', async () => {
    const writes: string[] = []
    const writer = {
      saveJson: async (_name: string, content: string) => { writes.push(content); return bridgeOk({ filePath: '/projects/demo/project.json' }) },
      saveJsonToPath: async (_path: string, content: string) => { writes.push(content); return bridgeOk({ filePath: '/projects/demo/project.json' }) },
    }
    const result = await saveProjectDocument(
      writer,
      project,
      null,
      null,
      true,
      current => current,
      { a: '/projects/demo/excel/a.xlsx', b: '/projects/shared/b.xlsx' },
    )
    expect(result.status).toBe('ok')
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[1]).project.workbooks.map((workbook: { sourcePath: string }) => workbook.sourcePath)).toEqual([
      'excel/a.xlsx',
      '../shared/b.xlsx',
    ])
    if (result.status === 'ok') expect(result.project.workbooks.map(workbook => workbook.sourcePath)).toEqual(['excel/a.xlsx', '../shared/b.xlsx'])
  })
  it('recalculates relative sources on Save As and keeps cross-drive Windows paths absolute', async () => {
    const writes: string[] = []
    const movedProject = {
      ...project,
      workbooks: [
        { ...project.workbooks[0], sourcePath: 'excel/a.xlsx' },
        { ...project.workbooks[1], sourcePath: 'D:\\shared\\b.xlsx' },
      ],
    }
    const writer = {
      saveJson: async (_name: string, content: string) => { writes.push(content); return bridgeOk({ filePath: 'C:\\new\\project.json' }) },
      saveJsonToPath: async (_path: string, content: string) => { writes.push(content); return bridgeOk({ filePath: 'C:\\new\\project.json' }) },
    }
    const result = await saveProjectDocument(writer, movedProject, null, 'C:\\old\\project.json', true, current => current)
    expect(result.status).toBe('ok')
    expect(JSON.parse(writes[1]).project.workbooks.map((workbook: { sourcePath: string }) => workbook.sourcePath)).toEqual([
      '../old/excel/a.xlsx',
      'D:\\shared\\b.xlsx',
    ])
  })
})
