import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { bridgeError, bridgeOk } from '../../shared/bridgeResult'
import type { ExportedProject } from '../types'
import { activateProjectWorkbook, reassignProjectWorkbook, removeProjectWorkbook } from '../services/project'
import { decodeProjectDocument, inspectProjectWorkbookSources, projectRecoveryContent, saveProjectDocument } from '../services/projectLifecycle'
import { canonicalProjectJson, serializeProject } from '../services/serializer'
import { WorkspaceStateCoordinator } from '../services/workspaceHistory'
import { builtInFeatureRegistry } from '../features/builtinRegistry'
import type { WorkbookReader } from '../services/workbook'

function fixture(): ExportedProject {
  return JSON.parse(readFileSync(new URL('./fixtures/project-v3-complete.json', import.meta.url), 'utf8')) as ExportedProject
}

function decodeFixture() {
  const decoded = decodeProjectDocument(JSON.stringify(fixture()))
  if (decoded.status !== 'ok') throw new Error(decoded.message)
  return decoded.document
}

describe('Project v3 complete fixture persistence', () => {
  it('survives current-path save, Save As, and recovery without semantic loss', async () => {
    const original = fixture()
    const { project, parseResult } = decodeFixture()
    const writes: Array<{ path: string; content: string }> = []
    const writer = {
      saveJson: vi.fn(async (_name: string, content: string) => {
        writes.push({ path: '/tmp/Complete v3 fixture.json', content })
        return bridgeOk({ filePath: '/tmp/Complete v3 fixture.json' })
      }),
      saveJsonToPath: vi.fn(async (path: string, content: string) => {
        writes.push({ path, content })
        return bridgeOk({ filePath: path })
      }),
    }

    const current = await saveProjectDocument(writer, project, parseResult, '/tmp/Complete v3 fixture.json', false, value => builtInFeatureRegistry.prepareForSave(value))
    expect(current.status).toBe('ok')
    const saveAs = await saveProjectDocument(writer, project, parseResult, null, true, value => builtInFeatureRegistry.prepareForSave(value))
    expect(saveAs.status).toBe('ok')
    for (const write of writes) {
      expect(canonicalProjectJson(JSON.parse(write.content))).toBe(canonicalProjectJson(original))
    }

    const recovered = decodeProjectDocument(projectRecoveryContent(project, parseResult))
    expect(recovered.status).toBe('ok')
    if (recovered.status === 'ok') {
      expect(canonicalProjectJson(serializeProject(recovered.document.project, recovered.document.parseResult))).toBe(canonicalProjectJson(original))
    }
  })

  it('makes relative workbook sources recoverable without changing the live project', () => {
    const { project, parseResult } = decodeFixture()
    const relative = {
      ...project,
      workbooks: project.workbooks.map((workbook, index) => ({ ...workbook, sourcePath: `sources/book-${index + 1}.xlsx` })),
    }
    const recovered = decodeProjectDocument(projectRecoveryContent(relative, parseResult, '/projects/demo/project.json'))
    expect(recovered.status).toBe('ok')
    if (recovered.status === 'ok') {
      expect(recovered.document.project.workbooks.map(workbook => workbook.sourcePath)).toEqual([
        '/projects/demo/sources/book-1.xlsx',
        '/projects/demo/sources/book-2.xlsx',
      ])
    }
    expect(relative.workbooks.map(workbook => workbook.sourcePath)).toEqual(['sources/book-1.xlsx', 'sources/book-2.xlsx'])
  })

  it('preserves all feature state through workbook switching and undo/redo', () => {
    const { project } = decodeFixture()
    const coordinator = new WorkspaceStateCoordinator()
    const switched = coordinator.transact(project, current => activateProjectWorkbook(current, 'costs', builtInFeatureRegistry))
    expect(switched.snapshot.activeWorkbookId).toBe('costs')
    expect(switched.snapshot.blocks).toEqual(project.blocks)
    expect(switched.snapshot.regions).toEqual(project.regions)

    const undone = coordinator.undo(switched.snapshot)
    expect(undone?.snapshot).toEqual(project)
    const redone = coordinator.redo(undone!.snapshot)
    expect(redone?.snapshot).toEqual(switched.snapshot)
  })

  it('contains reassign/remove mutations to the selected workbook ownership boundary', () => {
    const { project } = decodeFixture()
    const reassigned = reassignProjectWorkbook(project, 'costs', 'costs-new.xlsx', '/new/costs.xlsx')
    expect(reassigned.workbooks.find(item => item.id === 'sales')).toEqual(project.workbooks.find(item => item.id === 'sales'))
    expect(reassigned.blocks).toEqual(project.blocks)
    expect(reassigned.regions).toEqual(project.regions)

    const removed = removeProjectWorkbook(reassigned, 'costs', builtInFeatureRegistry, 'sales')
    expect(removed.workbooks.map(item => item.id)).toEqual(['sales'])
    expect(removed.blocks.map(item => item.id)).toEqual(['sales-block'])
    expect(removed.regions.map(item => item.id)).toEqual(['sales-region'])
  })

  it('reports unavailable sources without mutating the complete project', async () => {
    const { project } = decodeFixture()
    const before = structuredClone(project)
    const reader: WorkbookReader = { sheetNames: () => ['Orders', 'Summary'], getActiveSheet: () => null, getSheet: () => null }
    const availability = await inspectProjectWorkbookSources(
      project,
      async path => path.includes('sales') ? bridgeOk(new ArrayBuffer(1)) : bridgeError('missing'),
      async () => reader,
    )
    expect(availability?.availableIds).toEqual(['sales'])
    expect(availability?.unavailableIds).toEqual(['costs'])
    expect(project).toEqual(before)
  })
})
