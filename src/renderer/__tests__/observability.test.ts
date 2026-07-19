import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordBridgeFailure, recordParseFailure } from '../services/observability'

const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

afterEach(() => warn.mockClear())

describe('local diagnostics', () => {
  it('records bridge error metadata without the host error message', () => {
    recordBridgeFailure('open-workbook', {
      status: 'error',
      error: { code: 'access', message: 'Workbook /private/secret.xlsx must be selected first.' },
    })

    expect(warn).toHaveBeenCalledOnce()
    const payload = String(warn.mock.calls[0][1])
    expect(payload).toContain('"operation":"open-workbook"')
    expect(payload).toContain('"code":"access"')
    expect(payload).not.toContain('secret.xlsx')
  })

  it('records parse codes and source identity without raw workbook values', () => {
    recordParseFailure('parse-preview', {
      success: false,
      data: {},
      blocks: [],
      diagnostics: [{ code: 'type-conversion', severity: 'warning', blockId: 'records', row: 1, column: 'amount', message: 'raw value secret-123 could not convert' }],
    })

    const payload = String(warn.mock.calls[0][1])
    expect(payload).toContain('"code":"type-conversion"')
    expect(payload).toContain('"blockId":"records"')
    expect(payload).not.toContain('secret-123')
  })
})
