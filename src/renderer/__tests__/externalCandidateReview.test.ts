import { describe, expect, it } from 'vitest'
import { createExternalCandidateReviewCapability } from '../features/externalReview/candidateReview'
import { createProject } from '../services/project'
import { serializeProject } from '../services/serializer'

describe('external candidate review capability', () => {
  it('accepts strict Project v3 result data without mutating open configuration', () => {
    const project = createProject('Review')
    project.id = 'review-project'
    const before = structuredClone(project)
    const candidate = serializeProject(project, { success: true, data: {}, blocks: [], regionResults: [] })
    const result = createExternalCandidateReviewCapability(project, null).review('candidate.json', candidate)
    expect(result).toMatchObject({ sourceName: 'candidate.json', status: 'validated', differences: [] })
    expect(project).toEqual(before)
  })

  it('rejects malformed and differently associated candidates', () => {
    const project = createProject('Review')
    project.id = 'open-project'
    const capability = createExternalCandidateReviewCapability(project, null)
    expect(capability.review('bad.json', { version: 3 }).status).toBe('invalid')

    const other = { ...project, id: 'other-project' }
    const mismatch = capability.review('other.json', serializeProject(other, null))
    expect(mismatch.status).toBe('invalid')
    expect(mismatch.diagnostics.map(item => item.code)).toContain('project-association-mismatch')
    expect(project.id).toBe('open-project')
  })

  it('reports result differences while ignoring candidate configuration', () => {
    const project = createProject('Review')
    project.id = 'review-project'
    project.workbooks = [{ id: 'book', name: 'book.xlsx' }]
    const candidateProject = { ...project, name: 'Untrusted rename' }
    const candidate = serializeProject(candidateProject, {
      success: true,
      data: { book: {} },
      blocks: [],
      regionResults: [],
    })
    const review = createExternalCandidateReviewCapability(project, null).review('candidate.json', candidate)
    expect(review.status).toBe('validated')
    expect(review.diagnostics.map(item => item.code)).toContain('candidate-configuration-ignored')
    expect(project.name).toBe('Review')
  })
})
