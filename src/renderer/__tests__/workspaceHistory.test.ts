import { describe, expect, it } from 'vitest'
import { WorkspaceHistory, type WorkspaceSnapshot } from '../services/workspaceHistory'

function snapshot(label: string): WorkspaceSnapshot {
  return {
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
