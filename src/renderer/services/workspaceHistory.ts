import type { BlockConfig, RegionConfig } from '../types'
import type { FocusMode } from '../components/ConfigPanel'

export interface WorkspaceSnapshot {
  blocks: BlockConfig[]
  regions: RegionConfig[]
  activeBlockId: string
  activeRegionId: string | null
  focusMode: FocusMode
}

function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return structuredClone(snapshot)
}

export class WorkspaceHistory {
  private past: WorkspaceSnapshot[] = []
  private future: WorkspaceSnapshot[] = []

  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }

  push(snapshot: WorkspaceSnapshot): void {
    this.past.push(cloneSnapshot(snapshot))
    if (this.past.length > 50) this.past.shift()
    this.future = []
  }

  undo(current: WorkspaceSnapshot): WorkspaceSnapshot | null {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(cloneSnapshot(current))
    return cloneSnapshot(previous)
  }

  redo(current: WorkspaceSnapshot): WorkspaceSnapshot | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(cloneSnapshot(current))
    return cloneSnapshot(next)
  }

  clear(): void { this.past = []; this.future = [] }
}
