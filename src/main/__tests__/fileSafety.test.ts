import { describe, expect, it } from 'vitest'
import { isSupportedWorkbookPath, sanitizeJsonFileName, withTimeout } from '../fileSafety'

describe('main-process file safety policy', () => {
  it('accepts only supported workbook extensions', () => {
    expect(isSupportedWorkbookPath('/tmp/data.XLSX')).toBe(true)
    expect(isSupportedWorkbookPath('/tmp/data.xls')).toBe(true)
    expect(isSupportedWorkbookPath('/tmp/data.csv')).toBe(false)
  })

  it('constrains save names to a single JSON filename', () => {
    expect(sanitizeJsonFileName('../../unsafe name')).toBe('unsafe_name.json')
    expect(sanitizeJsonFileName('report.json')).toBe('report.json')
    expect(sanitizeJsonFileName(null)).toBe('project.json')
  })

  it('rejects timed-out operations', async () => {
    await expect(withTimeout(new Promise(() => {}), 'Timed out', 1)).rejects.toThrow('Timed out')
  })
})
