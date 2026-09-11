import { DEFAULT_WORKBOOK_DISPLAY_SETTINGS, DEFAULT_WORKBOOK_LOAD_SETTINGS, type ExportedProject, type ParseResult, type ProjectConfig, type RegionParseResult } from '../types'
import { isRecord, validateProjectV3Document } from './projectV3Validation'

function omitComputedPropertiesField(block: unknown): unknown {
  if (!isRecord(block) || !Object.prototype.hasOwnProperty.call(block, 'computedProperties')) return block
  const { computedProperties: _retired, ...rest } = block
  return rest
}

function omitRetiredComputedProperties(project: Record<string, unknown>): Record<string, unknown> {
  return {
    ...project,
    blocks: Array.isArray(project.blocks) ? project.blocks.map(omitComputedPropertiesField) : project.blocks,
    regions: Array.isArray(project.regions)
      ? project.regions.map(region => {
          if (!isRecord(region) || !Array.isArray(region.blocks)) return region
          return { ...region, blocks: region.blocks.map(omitComputedPropertiesField) }
        })
      : project.regions,
  }
}

export const CURRENT_PROJECT_VERSION = 3 as const

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export interface DeserializedProject {
  project: ProjectConfig
  parseResult: ParseResult | null
}

export interface ProjectLoadResult {
  project?: DeserializedProject
  errors: string[]
}

function parseResultFrom(value: Record<string, unknown>): ParseResult {
  return {
    success: true,
    data: value.data as Record<string, unknown>,
    blocks: value.blockResults as ParseResult['blocks'],
    regionResults: Array.isArray(value.regionResults) ? value.regionResults as RegionParseResult[] : undefined,
  }
}

export function serializeProject(project: ProjectConfig, parseResult: ParseResult | null): ExportedProject {
  return {
    version: CURRENT_PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    project: omitRetiredComputedProperties({
      ...project,
      ...(project.workbookLoadSettings ? { workbookLoadSettings: { ...DEFAULT_WORKBOOK_LOAD_SETTINGS, ...project.workbookLoadSettings } } : {}),
      workbooks: project.workbooks.map(workbook => ({
        ...workbook,
        displaySettings: { ...DEFAULT_WORKBOOK_DISPLAY_SETTINGS, ...workbook.displaySettings },
      })),
    }) as ProjectConfig,
    data: parseResult?.data || {},
    blockResults: parseResult?.blocks || [],
    ...(parseResult?.regionResults?.length ? { regionResults: parseResult.regionResults } : {}),
  }
}

/** Deterministic Project v3 semantics used by adapters and golden tests. */
export function canonicalProjectJson(project: ExportedProject): string {
  const { exportedAt: _exportedAt, ...semanticProject } = project
  return stableStringify(semanticProject)
}

export function loadProject(value: unknown): ProjectLoadResult {
  const document = isRecord(value) && isRecord(value.project)
    ? { ...value, project: omitRetiredComputedProperties(value.project) }
    : value
  const errors = validateProjectV3Document(document)
  if (errors.length || !isRecord(document) || !isRecord(document.project)) return { errors }
  const loadedProject = structuredClone(document.project) as ProjectConfig
  const project: ProjectConfig = {
    ...loadedProject,
    workbooks: loadedProject.workbooks.map(workbook => ({
      ...workbook,
      displaySettings: { ...DEFAULT_WORKBOOK_DISPLAY_SETTINGS, ...workbook.displaySettings },
    })),
  }
  return {
    errors: [],
    project: {
      project,
      parseResult: parseResultFrom(value),
    },
  }
}
