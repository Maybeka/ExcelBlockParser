import { describe, expect, it } from 'vitest'
import { changedWorkbookSourceIds, fingerprintWorkbookSource } from '../services/workbookSourceFingerprint'

describe('workbook source fingerprints', () => {
  it('is stable for identical workbook bytes and changes with content', () => {
    const original = new TextEncoder().encode('workbook-v1').buffer
    const changed = new TextEncoder().encode('workbook-v2').buffer

    expect(fingerprintWorkbookSource(original)).toBe(fingerprintWorkbookSource(original))
    expect(fingerprintWorkbookSource(changed)).not.toBe(fingerprintWorkbookSource(original))
  })

  it('reports only configured sources that changed from the prior preview', () => {
    expect(changedWorkbookSourceIds(
      { a: '10:original', b: '20:unchanged' },
      { a: '10:changed', b: '20:unchanged', c: '30:new' },
    )).toEqual(['a'])
  })

  it('does not prompt for the first preview', () => {
    expect(changedWorkbookSourceIds(null, { a: '10:initial' })).toEqual([])
  })
})
