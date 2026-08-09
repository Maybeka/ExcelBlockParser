import { describe, expect, it } from 'vitest'
import { WorkspaceHistory, WorkspaceStateCoordinator, type WorkspaceSnapshot } from '../services/workspaceHistory'

function snapshot(label: string): WorkspaceSnapshot {
  return {
    id: 'project-test', name: 'Test project', workbooks: [], activeWorkbookId: null,
    blocks: [{ id: label, label, range: null, activeSheet: null, headerRows: [0], collapsed: false, selectionLocked: false, columns: [], dataSnapshot: null }],
    regions: [], activeBlockId: label, activeRegionId: null, focusMode: 'always-editable',
  }
}

describe('WorkspaceHistory', () => {
  it('restores prior states and supports redo', () => {
    const history = new WorkspaceHistory()
    const first = snapshot('first')
    const second = snapshot('second')
    history.push(first)
    expect(history.undo(second)?.blocks[0].label).toBe('first')
    expect(history.redo(first)?.blocks[0].label).toBe('second')
  })

  it('does not retain references to mutable workspace state', () => {
    const history = new WorkspaceHistory()
    const first = snapshot('first')
    history.push(first)
    first.blocks[0].label = 'mutated'
    expect(history.undo(snapshot('second'))?.blocks[0].label).toBe('first')
  })
})

describe('WorkspaceStateCoordinator', () => {
  it('records one atomic transaction and dirty transition', () => {
    const coordinator = new WorkspaceStateCoordinator()
    const current = snapshot('one')
    const changed = coordinator.transact(current, value => ({ ...value, name: 'two' }))
    expect(changed).toMatchObject({ changed: true, dirty: true, snapshot: { name: 'two' } })
    expect(coordinator.canUndo).toBe(true)
    expect(coordinator.undo(changed.snapshot)?.snapshot.name).toBe('Test project')
  })

  it('does not create history for an unchanged transaction and resets on close', () => {
    const coordinator = new WorkspaceStateCoordinator()
    expect(coordinator.transact(snapshot('one'), value => value).changed).toBe(false)
    expect(coordinator.canUndo).toBe(false)
    coordinator.record(snapshot('one'))
    expect(coordinator.isDirty).toBe(true)
    coordinator.reset()
    expect(coordinator.isDirty).toBe(false)
    expect(coordinator.canUndo).toBe(false)
  })
})
