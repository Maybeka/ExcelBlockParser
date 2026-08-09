import type { ProjectConfig } from '../types'

/** A complete persistent project state, excluding only runtime file handles. */
export type WorkspaceSnapshot = ProjectConfig

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

export interface WorkspaceTransition {
  snapshot: WorkspaceSnapshot
  dirty: boolean
  changed: boolean
}

/** Coordinates atomic durable edits independently of React rendering. */
export class WorkspaceStateCoordinator {
  private history = new WorkspaceHistory()
  private dirty = false

  get canUndo(): boolean { return this.history.canUndo }
  get canRedo(): boolean { return this.history.canRedo }
  get isDirty(): boolean { return this.dirty }

  transact(current: WorkspaceSnapshot, update: (snapshot: WorkspaceSnapshot) => WorkspaceSnapshot): WorkspaceTransition {
    const next = update(cloneSnapshot(current))
    if (JSON.stringify(next) === JSON.stringify(current)) return { snapshot: current, dirty: this.dirty, changed: false }
    this.history.push(current)
    this.dirty = true
    return { snapshot: next, dirty: true, changed: true }
  }

  record(current: WorkspaceSnapshot): void {
    this.history.push(current)
    this.dirty = true
  }

  undo(current: WorkspaceSnapshot): WorkspaceTransition | null {
    const snapshot = this.history.undo(current)
    if (!snapshot) return null
    this.dirty = true
    return { snapshot, dirty: true, changed: true }
  }

  redo(current: WorkspaceSnapshot): WorkspaceTransition | null {
    const snapshot = this.history.redo(current)
    if (!snapshot) return null
    this.dirty = true
    return { snapshot, dirty: true, changed: true }
  }

  markSaved(): void { this.dirty = false }
  markDirty(): void { this.dirty = true }
  reset(): void { this.history.clear(); this.dirty = false }
}
