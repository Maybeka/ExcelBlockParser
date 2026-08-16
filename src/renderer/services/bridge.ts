/**
 * Platform-agnostic bridge — auto-detects Electron vs Wails at runtime.
 *
 * Electron: uses window.electronAPI (contextBridge from preload)
 * Wails:    uses generated Go bindings from wailsjs/go/main/App
 * Browser:  throws descriptive errors (used for dev/testing)
 */
import { bridgeCancelled, bridgeError, bridgeOk, type BridgeResult } from '../../shared/bridgeResult'
import type { PythonArtifact, PythonArtifactExportResult, PythonProjectResult } from '../../shared/pythonRuntime'

export type { PythonProjectResult } from '../../shared/pythonRuntime'

export interface BridgeAPI {
  openXlsx: () => Promise<BridgeResult<string>>
  readFile: (filePath: string) => Promise<BridgeResult<ArrayBuffer>>
  saveJson: (defaultName: string, jsonData: string) => Promise<BridgeResult<{ filePath: string }>>
  saveJsonToPath: (filePath: string, jsonData: string) => Promise<BridgeResult<{ filePath: string }>>
  openJson: () => Promise<BridgeResult<{ filePath: string; content: string }>>
  saveRecovery: (jsonData: string) => Promise<BridgeResult<void>>
  loadRecovery: () => Promise<BridgeResult<string | null>>
  clearRecovery: () => Promise<BridgeResult<void>>
  log: (level: string, ...args: unknown[]) => void
  openPreviewWindow: (blockId: string) => Promise<void>
  setPreviewData: (blockId: string, data: unknown) => Promise<void>
  getPreviewData: (blockId: string) => Promise<unknown>
  closePreviewWindow: () => Promise<void>
  onPreviewReload: (callback: (blockId: string) => void) => () => void
  cancelPythonRun: () => Promise<BridgeResult<boolean>>
  runProjectPython: (source: string, contextJson: string) => Promise<BridgeResult<PythonProjectResult>>
  exportPythonArtifacts: (projectName: string, artifacts: PythonArtifact[]) => Promise<BridgeResult<PythonArtifactExportResult>>
}

// ── Wails bridge ────────────────────────────────────────────────────────────

export interface WailsGoAPI {
  main?: {
    App?: {
      OpenXlsx: () => Promise<string>
      ReadFile: (path: string) => Promise<number[]>
      SaveJson: (name: string, data: string) => Promise<{ success: boolean; filePath: string; error: string }>
      SaveJsonToPath: (path: string, data: string) => Promise<{ success: boolean; filePath: string; error: string }>
      OpenJson: () => Promise<{ filePath: string; content: string } | null>
      SaveRecovery: (data: string) => Promise<void>
      LoadRecovery: () => Promise<string | null>
      ClearRecovery: () => Promise<void>
      OpenPreviewWindow: (blockId: string) => Promise<void>
      SetPreviewData: (blockId: string, data: unknown) => Promise<void>
      GetPreviewData: (blockId: string) => Promise<unknown>
      ClosePreviewWindow: () => Promise<void>
      CancelPythonRun: () => Promise<boolean>
      RunProjectPython: (source: string, contextJson: string) => Promise<PythonProjectResult>
      ExportPythonArtifacts: (projectName: string, artifactsJson: string) => Promise<{ success: boolean; directory: string; written: number; error: string }>
    }
  }
}

declare global {
  interface Window {
    electronAPI?: BridgeAPI
    go?: WailsGoAPI
  }
}

export function createWailsBridge(go: WailsGoAPI | undefined): BridgeAPI {
  const App = go?.main?.App
  if (!App) throw new Error('Wails runtime not available')
  const requiredMethods = [
    'OpenXlsx', 'ReadFile', 'SaveJson', 'SaveJsonToPath', 'OpenJson',
    'SaveRecovery', 'LoadRecovery', 'ClearRecovery',
    'OpenPreviewWindow', 'SetPreviewData', 'GetPreviewData', 'ClosePreviewWindow',
    'CancelPythonRun', 'RunProjectPython', 'ExportPythonArtifacts',
  ] as const
  if (requiredMethods.some(method => typeof App[method] !== 'function')) {
    throw new Error('Wails runtime is missing a required desktop capability')
  }

  return {
    openXlsx: async () => {
      try {
        const path = await App.OpenXlsx()
        return path ? bridgeOk(path) : bridgeCancelled()
      } catch (error) { return bridgeError(error) }
    },
    readFile: async (filePath: string) => {
      try {
        const raw: unknown = await App.ReadFile(filePath)
        if (!raw) return bridgeError(`Failed to read file: ${filePath}`)
        if (typeof raw === 'string') {
          const binary = atob(raw)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          return bridgeOk(bytes.buffer as ArrayBuffer)
        }
        if (raw instanceof Uint8Array) return bridgeOk(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
        if (Array.isArray(raw)) return bridgeOk(new Uint8Array(raw).buffer as ArrayBuffer)
        return bridgeError(`Unexpected file data type: ${typeof raw}`)
      } catch (error) { return bridgeError(error) }
    },
    saveJson: async (defaultName: string, jsonData: string) => {
      try {
        const result = await App.SaveJson(defaultName, jsonData)
        if (result.success && result.filePath) return bridgeOk({ filePath: result.filePath })
        return result.error?.toLowerCase() === 'cancelled' ? bridgeCancelled() : bridgeError(result.error || 'Unable to save JSON.')
      } catch (error) { return bridgeError(error) }
    },
    saveJsonToPath: async (filePath: string, jsonData: string) => {
      try {
        const result = await App.SaveJsonToPath(filePath, jsonData)
        if (result.success && result.filePath) return bridgeOk({ filePath: result.filePath })
        return bridgeError(result.error || 'Unable to save project.')
      } catch (error) { return bridgeError(error) }
    },
    openJson: async () => {
      try {
        const result = await App.OpenJson()
        return result ? bridgeOk(result) : bridgeCancelled()
      } catch (error) { return bridgeError(error) }
    },
    saveRecovery: async (jsonData) => { try { await App.SaveRecovery(jsonData); return bridgeOk(undefined) } catch (error) { return bridgeError(error) } },
    loadRecovery: async () => { try { return bridgeOk(await App.LoadRecovery()) } catch (error) { return bridgeError(error) } },
    clearRecovery: async () => { try { await App.ClearRecovery(); return bridgeOk(undefined) } catch (error) { return bridgeError(error) } },
    log: (level: string, ...args: unknown[]) => {
      console.log(`[${level}]`, ...args)
    },
    openPreviewWindow: async (blockId: string) => {
      await App.OpenPreviewWindow(blockId)
    },
    setPreviewData: async (blockId: string, data: unknown) => {
      await App.SetPreviewData(blockId, data)
    },
    getPreviewData: async (blockId: string) => {
      return App.GetPreviewData(blockId)
    },
    closePreviewWindow: async () => {
      await App.ClosePreviewWindow()
    },
    onPreviewReload: () => {
      console.warn('onPreviewReload not available in Wails')
      return () => {}
    },
    cancelPythonRun: async () => {
      try { return bridgeOk(await App.CancelPythonRun()) } catch (error) { return bridgeError(error) }
    },
    runProjectPython: async (source, contextJson) => {
      try { return bridgeOk(await App.RunProjectPython(source, contextJson)) } catch (error) { return bridgeError(error) }
    },
    exportPythonArtifacts: async (projectName, artifacts) => {
      try {
        const result = await App.ExportPythonArtifacts(projectName, JSON.stringify(artifacts))
        if (result.success) return bridgeOk({ directory: result.directory, written: result.written })
        return result.error?.toLowerCase() === 'cancelled' ? bridgeCancelled() : bridgeError(result.error || 'Unable to save generated files.')
      } catch (error) { return bridgeError(error) }
    },
  }
}

// ── Browser fallback (dev/playwright) ───────────────────────────────────────

function createBrowserBridge(): BridgeAPI {
  return {
    openXlsx: async () => bridgeError('openXlsx requires Electron or Wails'),
    readFile: async () => bridgeError('readFile requires Electron or Wails'),
    saveJson: async () => bridgeError('saveJson requires Electron or Wails'),
    saveJsonToPath: async () => bridgeError('saveJsonToPath requires Electron or Wails'),
    openJson: async () => bridgeError('openJson requires Electron or Wails'),
    saveRecovery: async (jsonData) => { localStorage.setItem('excel-block-parser.recovery', jsonData); return bridgeOk(undefined) },
    loadRecovery: async () => bridgeOk(localStorage.getItem('excel-block-parser.recovery')),
    clearRecovery: async () => { localStorage.removeItem('excel-block-parser.recovery'); return bridgeOk(undefined) },
    log: (level, ...args) => { console.log(`[${level}]`, ...args) },
    openPreviewWindow: async () => { console.warn('openPreviewWindow requires Electron or Wails') },
    setPreviewData: async () => { console.warn('setPreviewData requires Electron or Wails') },
    getPreviewData: async () => { console.warn('getPreviewData requires Electron or Wails'); return undefined },
    closePreviewWindow: async () => { console.warn('closePreviewWindow requires Electron or Wails') },
    onPreviewReload: () => {
      console.warn('onPreviewReload requires Electron or Wails')
      return () => {}
    },
    cancelPythonRun: async () => bridgeOk(false),
    runProjectPython: async () => bridgeError('Project Python requires the Wails runtime.'),
    exportPythonArtifacts: async () => bridgeError('Saving generated files requires the Wails runtime.'),
  }
}

// ── Detection + singleton ────────────────────────────────────────────────────

let _bridge: BridgeAPI | null = null

export function getBridge(): BridgeAPI {
  if (_bridge) return _bridge

  const runtimeWindow = typeof window === 'undefined' ? undefined : window
  if (runtimeWindow?.electronAPI) {
    _bridge = runtimeWindow.electronAPI
  } else if (runtimeWindow?.go?.main?.App) {
    _bridge = createWailsBridge(runtimeWindow.go)
  } else {
    _bridge = createBrowserBridge()
  }

  return _bridge
}

export const bridge = getBridge()
