import { describe, expect, it, vi } from 'vitest'
import { createWailsBridge, type WailsGoAPI } from '../services/bridge'

function wailsRuntime(overrides: Partial<NonNullable<NonNullable<WailsGoAPI['main']>['App']>> = {}): WailsGoAPI {
  return {
    main: {
      App: {
        OpenXlsx: vi.fn(async () => '/tmp/workbook.xlsx'),
        ReadFile: vi.fn(async () => [1, 2, 3]),
        SaveJson: vi.fn(async () => ({ success: true, filePath: '/tmp/session.json', error: '' })),
        OpenJson: vi.fn(async () => ({ filePath: '/tmp/session.json', content: '{"version":2}' })),
        SaveRecovery: vi.fn(async () => undefined),
        LoadRecovery: vi.fn(async () => '{"version":2}'),
        ClearRecovery: vi.fn(async () => undefined),
        OpenPreviewWindow: vi.fn(async () => undefined),
        SetPreviewData: vi.fn(async () => undefined),
        GetPreviewData: vi.fn(async () => ({ blockId: 'block' })),
        ClosePreviewWindow: vi.fn(async () => undefined),
        ...overrides,
      },
    },
  }
}

describe('Wails bridge contract', () => {
  it('adapts every required Wails capability through the renderer bridge', async () => {
    const runtime = wailsRuntime()
    const app = runtime.main!.App!
    const bridge = createWailsBridge(runtime)

    expect(await bridge.openXlsx()).toEqual({ status: 'ok', value: '/tmp/workbook.xlsx' })
    const readResult = await bridge.readFile('/tmp/workbook.xlsx')
    expect(readResult.status).toBe('ok')
    if (readResult.status === 'ok') expect([...new Uint8Array(readResult.value)]).toEqual([1, 2, 3])
    expect(await bridge.saveJson('session.json', '{"version":2}')).toEqual({ status: 'ok', value: { filePath: '/tmp/session.json' } })
    expect(await bridge.openJson()).toEqual({ status: 'ok', value: { filePath: '/tmp/session.json', content: '{"version":2}' } })
    await bridge.saveRecovery('{"version":2}')
    expect(await bridge.loadRecovery()).toEqual({ status: 'ok', value: '{"version":2}' })
    await bridge.clearRecovery()
    await bridge.openPreviewWindow('block')
    await bridge.setPreviewData('block', { blockId: 'block' })
    expect(await bridge.getPreviewData('block')).toEqual({ blockId: 'block' })
    await bridge.closePreviewWindow()

    expect(app.OpenXlsx).toHaveBeenCalledOnce()
    expect(app.ReadFile).toHaveBeenCalledWith('/tmp/workbook.xlsx')
    expect(app.ClosePreviewWindow).toHaveBeenCalledOnce()
  })

  it('preserves cancellation values and rejects an incomplete generated binding', async () => {
    const bridge = createWailsBridge(wailsRuntime({ OpenXlsx: async () => '', OpenJson: async () => null }))
    await expect(bridge.openXlsx()).resolves.toEqual({ status: 'cancelled' })
    await expect(bridge.openJson()).resolves.toEqual({ status: 'cancelled' })

    const incompleteRuntime = { main: { App: { OpenXlsx: async () => '' } } } as unknown as WailsGoAPI
    expect(() => createWailsBridge(incompleteRuntime)).toThrow('missing a required desktop capability')
  })

  it('translates Wails host failures into structured bridge errors', async () => {
    const bridge = createWailsBridge(wailsRuntime({
      ReadFile: async () => { throw new Error('The workbook must be selected through the Open dialog.') },
    }))

    await expect(bridge.readFile('/tmp/unapproved.xlsx')).resolves.toEqual({
      status: 'error',
      error: {
        code: 'access',
        message: 'The workbook must be selected through the Open dialog.',
      },
    })
  })
})
