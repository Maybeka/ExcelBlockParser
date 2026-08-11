import type { ExportedProject, ParseResult, ProjectConfig, RegionParseResult } from '../types'
import { isRecord, validateProjectV3Document } from './projectV3Validation'

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
    project,
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
  const errors = validateProjectV3Document(value)
  if (errors.length || !isRecord(value) || !isRecord(value.project)) return { errors }
  const project = value.project as unknown as ProjectConfig
  return {
    errors: [],
    project: {
      project: structuredClone(project),
      parseResult: parseResultFrom(value),
    },
  }
}
