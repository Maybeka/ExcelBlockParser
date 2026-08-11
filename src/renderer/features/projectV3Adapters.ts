import type { BlockConfig, BlockParseResult, ExportedProject, ProjectConfig, RegionConfig, RegionParseResult } from '../types'
import { loadProject, serializeProject } from '../services/serializer'

export interface FeatureAdapterDiagnostic {
  owner: 'builtin.extraction' | 'builtin.regions'
  code: 'project-v3-decode-failed' | 'project-v3-encode-failed'
  severity: 'error'
  message: string
}

export interface ExtractionFeatureState {
  blocks: BlockConfig[]
  activeBlockId: string
  focusMode: ProjectConfig['focusMode']
  data: Record<string, unknown>
  results: BlockParseResult[]
}

export interface RegionFeatureState {
  regions: RegionConfig[]
  activeRegionId: string | null
  results: RegionParseResult[]
}

export interface ProjectV3FeatureState {
  project: ProjectConfig
  extraction: ExtractionFeatureState
  regions: RegionFeatureState
}

export type ProjectV3AdapterResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; diagnostics: FeatureAdapterDiagnostic[] }

export function decodeProjectV3Features(value: unknown): ProjectV3AdapterResult<ProjectV3FeatureState> {
  const loaded = loadProject(value)
  if (!loaded.project) {
    return {
      status: 'error',
      diagnostics: [{
        owner: 'builtin.extraction', code: 'project-v3-decode-failed', severity: 'error',
        message: loaded.errors.join(' ') || 'The feature adapter accepts Project v3 documents only.',
      }],
    }
  }
  const { project, parseResult } = loaded.project
  return {
    status: 'ok',
    value: {
      project: structuredClone(project),
      extraction: {
        blocks: structuredClone(project.blocks), activeBlockId: project.activeBlockId,
        focusMode: project.focusMode, data: structuredClone(parseResult?.data ?? {}),
        results: structuredClone(parseResult?.blocks ?? []),
      },
      regions: {
        regions: structuredClone(project.regions), activeRegionId: project.activeRegionId,
        results: structuredClone(parseResult?.regionResults ?? []),
      },
    },
  }
}

export function encodeProjectV3Features(state: ProjectV3FeatureState): ProjectV3AdapterResult<ExportedProject> {
  const project: ProjectConfig = {
    ...structuredClone(state.project),
    blocks: structuredClone(state.extraction.blocks),
    regions: structuredClone(state.regions.regions),
    activeBlockId: state.extraction.activeBlockId,
    activeRegionId: state.regions.activeRegionId,
    focusMode: state.extraction.focusMode,
  }
  const encoded = serializeProject(project, {
    success: true,
    data: structuredClone(state.extraction.data),
    blocks: structuredClone(state.extraction.results),
    regionResults: structuredClone(state.regions.results),
  })
  const verified = loadProject(encoded)
  if (!verified.project) {
    return {
      status: 'error',
      diagnostics: [{
        owner: 'builtin.extraction', code: 'project-v3-encode-failed', severity: 'error',
        message: verified.errors.join(' '),
      }],
    }
  }
  return { status: 'ok', value: encoded }
}
