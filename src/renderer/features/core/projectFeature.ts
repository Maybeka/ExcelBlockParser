import type { CellRange, ParseDiagnostic, ParseResult, PreviewData, ProjectConfig } from '../../types'
import type { DiagnosticFocusTarget } from '../../services/diagnostics'
import type { WorkbookReader } from '../../services/workbook'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'

export interface WorkbookLoadedEvent {
  workbookId: string
  fileName: string
  filePath: string
  sheetNames: string[]
  activeSheetName: string | null
}

export interface ProjectFeatureExecution {
  data?: Record<string, unknown>
  resultFields?: Record<string, unknown>
  diagnostics?: ParseDiagnostic[]
  snapshots?: ReadonlyMap<string, unknown[][]>
}

export interface ProjectExecutionSummary {
  result: ParseResult
  snapshots: ReadonlyMap<string, unknown[][]>
}

export interface FeatureSelectionEvent {
  workbookId: string
  range: CellRange | null
  activeSheet: string | null
}

export interface FeatureCanvasRange {
  itemId: string
  range: CellRange
  color: string
  activeSheet?: string | null
}

export interface FeatureExecutionContext {
  signal: AbortSignal
}

/** Project operations shared by compile-time features. No scenario type is exposed. */
export interface ProjectFeatureModule {
  readonly id: string
  readonly schemaVersion: number
  initialize(project: ProjectConfig): ProjectConfig
  activateWorkbook(project: ProjectConfig, workbookId: string): ProjectConfig
  workbookLoaded(project: ProjectConfig, event: WorkbookLoadedEvent): ProjectConfig
  removeWorkbook(project: ProjectConfig, workbookId: string): ProjectConfig
  prepareForSave(project: ProjectConfig): ProjectConfig
  captureForSave?(project: ProjectConfig, workbookId: string | null, spreadsheet: SpreadsheetCapability): Promise<ProjectConfig>
  validate(project: ProjectConfig): readonly string[]
  diagnosticFocus(project: ProjectConfig, diagnostic: ParseDiagnostic): DiagnosticFocusTarget | null
  applyDiagnosticFocus?(project: ProjectConfig, target: DiagnosticFocusTarget): ProjectConfig
  selectionChanged?(project: ProjectConfig, event: FeatureSelectionEvent, spreadsheet: SpreadsheetCapability): ProjectConfig
  canvasRanges?(project: ProjectConfig, workbookId: string | null): readonly FeatureCanvasRange[]
  activeCanvasItems?(project: ProjectConfig): readonly string[]
  activeColumnItem?(project: ProjectConfig): string | null
  executionReady?(project: ProjectConfig): boolean
  onProjectOpen?(project: ProjectConfig): void | Promise<void>
  onProjectClose?(project: ProjectConfig): void | Promise<void>
  onActivate?(project: ProjectConfig): void | (() => void) | Promise<void | (() => void)>
  onDeactivate?(project: ProjectConfig): void | Promise<void>
  dispose?(): void | Promise<void>
  execute?(project: ProjectConfig, workbooks: ReadonlyMap<string, WorkbookReader>, context: FeatureExecutionContext): ProjectFeatureExecution | Promise<ProjectFeatureExecution>
  applyExecution?(project: ProjectConfig, execution: ProjectFeatureExecution): ProjectConfig
  previews?(project: ProjectConfig, result: ParseResult): ReadonlyMap<string, PreviewData>
}

export class BuiltInFeatureRegistry {
  private readonly modules: ProjectFeatureModule[]
  private readonly activationCleanups = new Map<string, () => void>()

  constructor(modules: readonly ProjectFeatureModule[]) {
    const ids = modules.map(module => module.id)
    if (new Set(ids).size !== ids.length) throw new Error('Built-in feature IDs must be unique.')
    this.modules = [...modules]
  }

  definitions(): readonly ProjectFeatureModule[] { return this.modules }

  async open(project: ProjectConfig): Promise<void> {
    for (const module of this.modules) {
      try { await module.onProjectOpen?.(project) } catch { /* Keep other modules available. */ }
    }
  }

  async activate(project: ProjectConfig): Promise<void> {
    for (const module of this.modules) {
      if (this.activationCleanups.has(module.id)) continue
      try {
        const cleanup = await module.onActivate?.(project)
        if (typeof cleanup === 'function') this.activationCleanups.set(module.id, cleanup)
      } catch { /* Keep other modules available. */ }
    }
  }

  async deactivate(project: ProjectConfig): Promise<void> {
    for (const module of [...this.modules].reverse()) {
      try { this.activationCleanups.get(module.id)?.() } catch { /* Continue teardown. */ }
      this.activationCleanups.delete(module.id)
      try { await module.onDeactivate?.(project) } catch { /* Continue teardown. */ }
    }
  }

  async close(project: ProjectConfig): Promise<void> {
    await this.deactivate(project)
    for (const module of [...this.modules].reverse()) {
      try { await module.onProjectClose?.(project) } catch { /* Continue teardown. */ }
    }
  }

  async dispose(project: ProjectConfig): Promise<void> {
    await this.close(project)
    for (const module of [...this.modules].reverse()) {
      try { await module.dispose?.() } catch { /* Continue teardown. */ }
    }
  }

  initialize(project: ProjectConfig): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.initialize(current) } catch { return current }
    }, project)
  }

  activateWorkbook(project: ProjectConfig, workbookId: string): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.activateWorkbook(current, workbookId) } catch { return current }
    }, project)
  }

  workbookLoaded(project: ProjectConfig, event: WorkbookLoadedEvent): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.workbookLoaded(current, event) } catch { return current }
    }, project)
  }

  removeWorkbook(project: ProjectConfig, workbookId: string): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.removeWorkbook(current, workbookId) } catch { return current }
    }, project)
  }

  prepareForSave(project: ProjectConfig): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.prepareForSave(current) } catch { return current }
    }, project)
  }

  async captureForSave(project: ProjectConfig, workbookId: string | null, spreadsheet: SpreadsheetCapability): Promise<ProjectConfig> {
    let current = project
    for (const module of this.modules) {
      try { current = await module.captureForSave?.(current, workbookId, spreadsheet) ?? current } catch { /* Preserve prior durable state. */ }
    }
    return current
  }

  validate(project: ProjectConfig): string[] {
    return this.modules.flatMap(module => {
      try { return module.validate(project) } catch (error) {
        return [`Feature "${module.id}" validation failed: ${error instanceof Error ? error.message : String(error)}`]
      }
    })
  }

  diagnosticFocus(project: ProjectConfig, diagnostic: ParseDiagnostic): DiagnosticFocusTarget | null {
    for (const module of this.modules) {
      let target: DiagnosticFocusTarget | null = null
      try { target = module.diagnosticFocus(project, diagnostic) } catch { /* Try the next module. */ }
      if (target) return target
    }
    return diagnostic.workbookId ? { workbookId: diagnostic.workbookId, sheetName: null, range: null } : null
  }

  applyDiagnosticFocus(project: ProjectConfig, target: DiagnosticFocusTarget): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.applyDiagnosticFocus?.(current, target) ?? current } catch { return current }
    }, project)
  }

  selectionChanged(project: ProjectConfig, event: FeatureSelectionEvent, spreadsheet: SpreadsheetCapability): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.selectionChanged?.(current, event, spreadsheet) ?? current } catch { return current }
    }, project)
  }

  canvasRanges(project: ProjectConfig, workbookId: string | null): FeatureCanvasRange[] {
    return this.modules.flatMap(module => {
      try { return [...(module.canvasRanges?.(project, workbookId) ?? [])] } catch { return [] }
    })
  }

  activeCanvasItems(project: ProjectConfig): string[] {
    return this.modules.flatMap(module => {
      try { return [...(module.activeCanvasItems?.(project) ?? [])] } catch { return [] }
    })
  }

  activeColumnItem(project: ProjectConfig): string | null {
    for (const module of this.modules) {
      try {
        const itemId = module.activeColumnItem?.(project)
        if (itemId) return itemId
      } catch { /* Try the next module. */ }
    }
    return null
  }

  executionReady(project: ProjectConfig): boolean {
    return this.modules.some(module => {
      try { return module.executionReady?.(project) ?? false } catch { return false }
    })
  }

  async execute(project: ProjectConfig, workbooks: ReadonlyMap<string, WorkbookReader>, signal: AbortSignal): Promise<ProjectExecutionSummary | null> {
    const executions: Array<{ module: ProjectFeatureModule; execution?: ProjectFeatureExecution }> = []
    for (const module of this.modules) {
      if (signal.aborted) return null
      try {
        const execution = await module.execute?.(project, workbooks, { signal })
        if (signal.aborted) return null
        executions.push({ module, execution })
      } catch (error) {
        if (signal.aborted) return null
        executions.push({
          module,
          execution: {
            diagnostics: [{
              code: 'unsupported-content' as const,
              severity: 'error' as const,
              message: `Feature "${module.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
            }],
          },
        })
      }
    }
    const diagnostics = executions.flatMap(item => item.execution?.diagnostics ?? [])
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
    const resultFields = Object.assign({}, ...executions.map(item => item.execution?.resultFields ?? {}))
    for (const reserved of ['success', 'data', 'diagnostics', 'error']) delete resultFields[reserved]
    const snapshots = new Map<string, unknown[][]>()
    for (const { execution } of executions) execution?.snapshots?.forEach((value, key) => snapshots.set(key, value))
    return {
      snapshots,
      result: {
        success: errors.length === 0,
        data: Object.assign({}, ...executions.map(item => item.execution?.data ?? {})),
        ...resultFields,
        diagnostics,
        error: errors[0]?.message,
      } as ParseResult,
    }
  }

  applyExecution(project: ProjectConfig, execution: ProjectExecutionSummary): ProjectConfig {
    return this.modules.reduce((current, module) => {
      try { return module.applyExecution?.(current, { ...execution.result, snapshots: execution.snapshots }) ?? current } catch { return current }
    }, project)
  }

  previews(project: ProjectConfig, result: ParseResult): Map<string, PreviewData> {
    const previews = new Map<string, PreviewData>()
    for (const module of this.modules) {
      try { module.previews?.(project, result).forEach((value, key) => previews.set(key, value)) } catch { /* Keep other feature previews available. */ }
    }
    return previews
  }
}
