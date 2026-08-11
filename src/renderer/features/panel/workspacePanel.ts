import type { ReactNode } from 'react'
import type { CellRange, ParseResult, PreviewData, ProjectConfig } from '../../types'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'
import type { FeaturePanelContribution } from './FeaturePanelHost'

export interface WorkspaceFeaturePanelContext {
  project: ProjectConfig
  loadedWorkbookId: string | null
  activeColIndex: number | null
  parseResult: ParseResult | null
  spreadsheet: SpreadsheetCapability
  requestedFeatureId: string | null
  transactProject(update: (project: ProjectConfig) => ProjectConfig): void
  selectProject(update: (project: ProjectConfig) => ProjectConfig): void
  run(): void
  setActiveColumn(colIndex: number | null): void
  setReconciliationItem(item: WorkspaceReconciliationItem | null): void
  takeReselectedRange(onRange: (range: CellRange) => void): void
  setPreviewSheet(sheetName: string | null): void
}

export interface WorkspaceReconciliationItem {
  id: string
  range: CellRange | null
  activeSheet: string | null
}

export interface WorkspaceFeatureResultContext {
  project: ProjectConfig
  result: ParseResult
  previews: ReadonlyMap<string, PreviewData>
}

export interface WorkspaceFeatureResultContribution {
  id: string
  label: string
  count: number
  render(): ReactNode
}

export interface WorkspaceFeaturePanelProvider {
  readonly featureId: string
  isActive(context: WorkspaceFeaturePanelContext): boolean
  contribute(context: WorkspaceFeaturePanelContext): FeaturePanelContribution
  navigation?(context: WorkspaceFeaturePanelContext): WorkspaceFeatureNavigationSection | null
  result?(context: WorkspaceFeatureResultContext): WorkspaceFeatureResultContribution | null
}

export interface WorkspaceFeatureNavigationItem {
  id: string
  label: string
  detail?: string
  active: boolean
  locked: boolean
  avatarClassName?: string
  select(): void
  move(direction: -1 | 1): void
}

export interface WorkspaceFeatureNavigationSection {
  id: string
  label: string
  emptyText: string
  items: WorkspaceFeatureNavigationItem[]
  addAction?: { label: string; run(): void }
}

export class WorkspaceFeaturePanelRegistry {
  constructor(private readonly providers: readonly WorkspaceFeaturePanelProvider[]) {
    const ids = providers.map(provider => provider.featureId)
    if (new Set(ids).size !== ids.length) throw new Error('Feature panel IDs must be unique.')
  }

  definitions(): readonly WorkspaceFeaturePanelProvider[] { return this.providers }

  select(context: WorkspaceFeaturePanelContext): FeaturePanelContribution {
    const requested = context.requestedFeatureId
      ? this.providers.find(provider => provider.featureId === context.requestedFeatureId)
      : null
    const provider = requested ?? this.providers.find(candidate => candidate.isActive(context)) ?? this.providers[0]
    if (!provider) throw new Error('At least one built-in feature panel must be registered.')
    return provider.contribute(context)
  }

  navigation(context: WorkspaceFeaturePanelContext): WorkspaceFeatureNavigationSection[] {
    return this.providers.flatMap(provider => {
      const section = provider.navigation?.(context)
      return section ? [section] : []
    })
  }

  results(context: WorkspaceFeatureResultContext): WorkspaceFeatureResultContribution[] {
    return this.providers.flatMap(provider => {
      const contribution = provider.result?.(context)
      return contribution ? [contribution] : []
    })
  }
}
