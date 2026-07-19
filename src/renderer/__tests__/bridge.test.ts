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

    expect(await bridge.openXlsx()).toBe('/tmp/workbook.xlsx')
    expect([...new Uint8Array(await bridge.readFile('/tmp/workbook.xlsx'))]).toEqual([1, 2, 3])
    expect(await bridge.saveJson('session.json', '{"version":2}')).toEqual({ success: true, filePath: '/tmp/session.json', error: '' })
    expect(await bridge.openJson()).toEqual({ filePath: '/tmp/session.json', content: '{"version":2}' })
    await bridge.saveRecovery('{"version":2}')
    expect(await bridge.loadRecovery()).toBe('{"version":2}')
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
    await expect(bridge.openXlsx()).resolves.toBeNull()
    await expect(bridge.openJson()).resolves.toBeNull()

    const incompleteRuntime = { main: { App: { OpenXlsx: async () => '' } } } as unknown as WailsGoAPI
    expect(() => createWailsBridge(incompleteRuntime)).toThrow('missing a required desktop capability')
  })
})
