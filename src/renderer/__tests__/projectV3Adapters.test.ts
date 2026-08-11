import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ExportedProject } from '../types'
import { canonicalProjectJson } from '../services/serializer'
import { decodeProjectV3Features, encodeProjectV3Features } from '../features/projectV3Adapters'

function projectFixture(): ExportedProject {
  return JSON.parse(readFileSync(new URL('./fixtures/project-v3-adapter.json', import.meta.url), 'utf8')) as ExportedProject
}

describe('Project v3 feature adapters', () => {
  it('decodes and re-encodes Project v3 without semantic changes', () => {
    const fixture = projectFixture()
    const decoded = decodeProjectV3Features(fixture)
    expect(decoded.status).toBe('ok')
    if (decoded.status !== 'ok') return
    const encoded = encodeProjectV3Features(decoded.value)
    expect(encoded.status).toBe('ok')
    if (encoded.status !== 'ok') return
    expect(canonicalProjectJson(encoded.value)).toBe(canonicalProjectJson(fixture))
  })

  it('keeps the input stable when encoding invalid feature state fails', () => {
    const decoded = decodeProjectV3Features(projectFixture())
    if (decoded.status !== 'ok') throw new Error('fixture failed')
    const before = structuredClone(decoded.value)
    decoded.value.extraction.activeBlockId = 'missing-block'
    const invalidInput = structuredClone(decoded.value)
    const encoded = encodeProjectV3Features(decoded.value)
    expect(encoded).toMatchObject({ status: 'error', diagnostics: [{ code: 'project-v3-encode-failed' }] })
    expect(decoded.value).toEqual(invalidInput)
    expect(before.project.activeBlockId).toBe('block-1')
  })

})
