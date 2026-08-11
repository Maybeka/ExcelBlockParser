import type { ParseResult, ProjectConfig } from '../../types'
import { loadProject } from '../../services/serializer'
import type { ExternalReviewFixture } from './ExternalResultReviewPanel'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

function stable(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? 'undefined'
}

export interface ExternalCandidateReviewCapability {
  review(sourceName: string, candidate: unknown): ExternalReviewFixture
}

/** Development-only structured input boundary. Candidate configuration is read for association checks only. */
export function createExternalCandidateReviewCapability(
  openProject: ProjectConfig,
  localResult: ParseResult | null,
): ExternalCandidateReviewCapability {
  return {
    review(sourceName, candidate) {
      const loaded = loadProject(candidate)
      if (!loaded.project) {
        return {
          sourceName,
          status: 'invalid',
          differences: [],
          diagnostics: loaded.errors.map((message, index) => ({ code: `candidate-invalid-${index + 1}`, message })),
        }
      }

      const diagnostics: ExternalReviewFixture['diagnostics'] = []
      const imported = loaded.project
      if (imported.project.id !== openProject.id) {
        diagnostics.push({ code: 'project-association-mismatch', message: 'Candidate project ID does not match the open project.' })
      }
      if (stable(imported.project) !== stable(openProject)) {
        diagnostics.push({ code: 'candidate-configuration-ignored', message: 'Candidate project configuration differs and was ignored.' })
      }

      const differences: ExternalReviewFixture['differences'] = []
      const localBlocks = new Map((localResult?.blocks ?? []).map(result => [`${result.workbookId ?? ''}:${result.blockId}`, result]))
      for (const result of imported.parseResult?.blocks ?? []) {
        const key = `${result.workbookId ?? ''}:${result.blockId}`
        if (stable(localBlocks.get(key)) !== stable(result)) {
          differences.push({ id: `block:${key}`, owner: `${result.workbookId ?? 'unmapped'} / ${result.label}`, summary: 'Candidate block result differs from the local result.' })
        }
      }
      const localRegions = new Map((localResult?.regionResults ?? []).map(result => [`${result.workbookId ?? ''}:${result.regionId}`, result]))
      for (const result of imported.parseResult?.regionResults ?? []) {
        const key = `${result.workbookId ?? ''}:${result.regionId}`
        if (stable(localRegions.get(key)) !== stable(result)) {
          differences.push({ id: `region:${key}`, owner: `${result.workbookId ?? 'unmapped'} / ${result.label}`, summary: 'Candidate region result differs from the local result.' })
        }
      }
      return {
        sourceName,
        status: diagnostics.some(item => item.code === 'project-association-mismatch') ? 'invalid' : 'validated',
        differences,
        diagnostics,
      }
    },
  }
}
