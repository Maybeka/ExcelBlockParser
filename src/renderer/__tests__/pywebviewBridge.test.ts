import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPywebviewBridge, type DesktopHostAPI } from '../services/bridge'
import { initializePywebview, persistPywebviewLocale, type PywebviewAPI } from '../services/pywebviewBootstrap'

function nativeAPI(): PywebviewAPI {
  const methods: DesktopHostAPI = {
    OpenXlsx: async () => '/tmp/book.xlsx', ReadFile: async () => [1, 2],
    SaveJson: async () => ({ success: false, filePath: '', error: 'cancelled' }),
    SaveJsonToPath: async path => ({ success: true, filePath: path, error: '' }),
    OpenJson: async () => null, OpenDroppedJson: async path => ({ filePath: path, content: '{}' }),
    SaveRecovery: async () => undefined, LoadRecovery: async () => null, ClearRecovery: async () => undefined,
    RequestClose: vi.fn(async () => undefined), ConfirmQuit: vi.fn(async () => undefined),
    OpenPreviewWindow: async () => undefined, SetPreviewData: async () => undefined,
    GetPreviewData: async () => null, ClosePreviewWindow: async () => undefined,
    CancelPythonRun: async () => true,
    RunProjectPython: async () => ({ ok: true, resultJson: '{}', stdout: '', stderr: '', error: '', hostError: '', durationMs: 1 }),
    ExportPythonArtifacts: async () => ({ success: false, directory: '', written: 0, error: 'cancelled' }),
    RasterizeLegacyEquationPreview: async () => [], ConvertMathTypeOLE: async () => ({ supported: true, mathMl: '<math/>' }),
  }
  return {
    ...methods, Ready: async () => undefined,
    Minimize: vi.fn(async () => undefined), ToggleMaximize: vi.fn(async () => true),
    RuntimeInfo: async () => ({ pywebview: '6.2.1', hostPython: '3.12', scriptPython: 'goccy', mathType: '0.2.0' }),
    LoadAppLocale: async () => null, SaveAppLocale: async () => undefined,
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('pywebview startup readiness', () => {
  it('restores the native language before handing control to the renderer', async () => {
    const api = nativeAPI()
    api.LoadAppLocale = async () => 'zh-CN'
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    api.Ready = async () => { expect(setItem).toHaveBeenCalledWith('excel-block-parser.locale', 'zh-CN') }
    vi.stubGlobal('window', Object.assign(new EventTarget(), { pywebview: { api } }))
    await initializePywebview()
  })

  it('does not hydrate invalid or missing native language preferences', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    for (const locale of [null, 'invalid']) {
      const api = nativeAPI()
      api.LoadAppLocale = async () => locale
      vi.stubGlobal('window', Object.assign(new EventTarget(), { pywebview: { api } }))
      await initializePywebview()
    }
    expect(setItem).not.toHaveBeenCalled()
  })

  it('serializes native saves and continues after a failed save', async () => {
    const api = nativeAPI()
    let finish!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
      .mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce(undefined)
    api.SaveAppLocale = save
    vi.stubGlobal('window', { pywebview: { api } })
    const first = persistPywebviewLocale('en-US')
    const second = persistPywebviewLocale('zh-CN')
    const failed = expect(second).rejects.toThrow('disk unavailable')
    const third = persistPywebviewLocale('en-US')
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    finish()
    await first
    await failed
    await third
    expect(save.mock.calls.map(([locale]) => locale)).toEqual(['en-US', 'zh-CN', 'en-US'])
  })

  it('waits for native methods when the initially injected API object is empty', async () => {
    vi.useFakeTimers()
    const api = nativeAPI()
    const runtimeInfo = vi.spyOn(api, 'RuntimeInfo')
    const ready = vi.spyOn(api, 'Ready')
    const target = Object.assign(new EventTarget(), { pywebview: { api: {} } })
    vi.stubGlobal('window', target)
    const starting = initializePywebview()
    expect(runtimeInfo).not.toHaveBeenCalled()
    target.dispatchEvent(new Event('pywebviewready'))
    expect(runtimeInfo).not.toHaveBeenCalled()
    Object.assign(target.pywebview.api, api)
    target.dispatchEvent(new Event('pywebviewready'))
    await starting
    expect(runtimeInfo).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits when the bridge object itself has not been injected yet', async () => {
    const target = Object.assign(new EventTarget(), { pywebview: undefined as Window['pywebview'] })
    vi.stubGlobal('window', target)
    const starting = initializePywebview()
    target.pywebview = { api: nativeAPI() }
    target.dispatchEvent(new Event('pywebviewready'))
    await starting
    expect(target.pywebview.runtimeInfo?.pywebview).toBe('6.2.1')
  })

  it('starts immediately when the complete API is already registered', async () => {
    const api = nativeAPI()
    const ready = vi.spyOn(api, 'Ready')
    const target = Object.assign(new EventTarget(), { pywebview: { api } })
    const listener = vi.spyOn(target, 'addEventListener')
    vi.stubGlobal('window', target)
    await initializePywebview()
    expect(ready).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalled()
  })

  it('times out and removes its listener if registration never finishes', async () => {
    vi.useFakeTimers()
    const target = Object.assign(new EventTarget(), { pywebview: { api: {} } })
    const remove = vi.spyOn(target, 'removeEventListener')
    vi.stubGlobal('window', target)
    const rejected = expect(initializePywebview()).rejects.toThrow('pywebview bridge initialization timed out')
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(remove).toHaveBeenCalledWith('pywebviewready', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('pywebview desktop bridge', () => {
  it('preserves native maximize results and the close confirmation protocol', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('document', { dispatchEvent })
    const api = nativeAPI()
    const bridge = createPywebviewBridge(api)
    expect(await bridge.toggleWindowMaximize()).toBe(true)
    await bridge.minimizeWindow()
    await bridge.closeWindow()
    await bridge.confirmCloseWindow?.()
    expect(api.ToggleMaximize).toHaveBeenCalledOnce()
    expect(api.Minimize).toHaveBeenCalledOnce()
    expect(api.RequestClose).toHaveBeenCalledOnce()
    expect(api.ConfirmQuit).toHaveBeenCalledOnce()
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0][0].type).toBe('desktopquit')
  })

  it('does not destroy the window before the confirmation RPC has returned', async () => {
    let acknowledge!: () => void
    const api = nativeAPI()
    api.ConfirmQuit = () => new Promise<void>(resolve => { acknowledge = resolve })
    const dispatchEvent = vi.fn()
    vi.stubGlobal('document', { dispatchEvent })
    const closing = createPywebviewBridge(api).confirmCloseWindow!()
    expect(dispatchEvent).not.toHaveBeenCalled()
    acknowledge()
    await closing
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })

  it('keeps cancellation and byte normalization consistent with the desktop contract', async () => {
    const bridge = createPywebviewBridge(nativeAPI())
    expect(await bridge.openJson()).toEqual({ status: 'cancelled' })
    expect(await bridge.saveJson('demo', '{}')).toEqual({ status: 'cancelled' })
    expect(await bridge.exportPythonArtifacts('demo', [])).toEqual({ status: 'cancelled' })
    const result = await bridge.readFile('/tmp/book.xlsx')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect([...new Uint8Array(result.value)]).toEqual([1, 2])
  })
})
