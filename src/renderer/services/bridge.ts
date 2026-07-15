/**
 * Platform-agnostic bridge — auto-detects Electron vs Wails at runtime.
 *
 * Electron: uses window.electronAPI (contextBridge from preload)
 * Wails:    uses generated Go bindings from wailsjs/go/main/App
 * Browser:  throws descriptive errors (used for dev/testing)
 */

export interface BridgeAPI {
  openXlsx: () => Promise<string | null>
  readFile: (filePath: string) => Promise<ArrayBuffer>
  saveJson: (defaultName: string, jsonData: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  openJson: () => Promise<{ filePath: string; content: string } | null>
  saveRecovery: (jsonData: string) => Promise<void>
  loadRecovery: () => Promise<string | null>
  clearRecovery: () => Promise<void>
  log: (level: string, ...args: unknown[]) => void
  openPreviewWindow: (blockId: string) => Promise<void>
  setPreviewData: (blockId: string, data: unknown) => Promise<void>
  getPreviewData: (blockId: string) => Promise<unknown>
  closePreviewWindow: () => Promise<void>
  onPreviewReload: (callback: (blockId: string) => void) => () => void
}

// ── Wails bridge ────────────────────────────────────────────────────────────

interface WailsGoAPI {
  main?: {
    App?: {
      OpenXlsx: () => Promise<string>
      ReadFile: (path: string) => Promise<number[]>
      SaveJson: (name: string, data: string) => Promise<{ success: boolean; filePath: string; error: string }>
      OpenJson: () => Promise<{ filePath: string; content: string } | null>
      SaveRecovery?: (data: string) => Promise<void>
      LoadRecovery?: () => Promise<string | null>
      ClearRecovery?: () => Promise<void>
      OpenPreviewWindow: (blockId: string) => Promise<void>
      SetPreviewData: (blockId: string, data: unknown) => Promise<void>
      GetPreviewData: (blockId: string) => Promise<unknown>
      ClosePreviewWindow: () => Promise<void>
    }
  }
}

declare global {
  interface Window {
    electronAPI?: BridgeAPI
    go?: WailsGoAPI
  }
}

function createWailsBridge(): BridgeAPI {
  const App = window.go?.main?.App
  if (!App) throw new Error('Wails runtime not available')

  return {
    openXlsx: async () => {
      const path = await App.OpenXlsx()
      return path || null
    },
    readFile: async (filePath: string) => {
      const raw: unknown = await App.ReadFile(filePath)
      if (!raw) throw new Error(`Failed to read file: ${filePath}`)
      if (typeof raw === 'string') {
        const binary = atob(raw)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        return bytes.buffer as ArrayBuffer
      }
      if (raw instanceof Uint8Array) {
        return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
      }
      if (Array.isArray(raw)) {
        return new Uint8Array(raw).buffer as ArrayBuffer
      }
      throw new Error(`Unexpected file data type: ${typeof raw}`)
    },
    saveJson: async (defaultName: string, jsonData: string) => {
      return App.SaveJson(defaultName, jsonData)
    },
    openJson: async () => {
      return App.OpenJson()
    },
    saveRecovery: async (jsonData) => { if (App.SaveRecovery) await App.SaveRecovery(jsonData); else localStorage.setItem('excel-block-parser.recovery', jsonData) },
    loadRecovery: async () => App.LoadRecovery ? App.LoadRecovery() : localStorage.getItem('excel-block-parser.recovery'),
    clearRecovery: async () => { if (App.ClearRecovery) await App.ClearRecovery(); else localStorage.removeItem('excel-block-parser.recovery') },
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
  }
}

// ── Browser fallback (dev/playwright) ───────────────────────────────────────

function createBrowserBridge(): BridgeAPI {
  return {
    openXlsx: async () => { throw new Error('openXlsx requires Electron or Wails') },
    readFile: async () => { throw new Error('readFile requires Electron or Wails') },
    saveJson: async () => { throw new Error('saveJson requires Electron or Wails') },
    openJson: async () => { throw new Error('openJson requires Electron or Wails') },
    saveRecovery: async (jsonData) => { localStorage.setItem('excel-block-parser.recovery', jsonData) },
    loadRecovery: async () => localStorage.getItem('excel-block-parser.recovery'),
    clearRecovery: async () => { localStorage.removeItem('excel-block-parser.recovery') },
    log: (level, ...args) => { console.log(`[${level}]`, ...args) },
    openPreviewWindow: async () => { console.warn('openPreviewWindow requires Electron or Wails') },
    setPreviewData: async () => { console.warn('setPreviewData requires Electron or Wails') },
    getPreviewData: async () => { console.warn('getPreviewData requires Electron or Wails'); return undefined },
    closePreviewWindow: async () => { console.warn('closePreviewWindow requires Electron or Wails') },
    onPreviewReload: () => {
      console.warn('onPreviewReload requires Electron or Wails')
      return () => {}
    },
  }
}

// ── Detection + singleton ────────────────────────────────────────────────────

let _bridge: BridgeAPI | null = null

export function getBridge(): BridgeAPI {
  if (_bridge) return _bridge

  if (window.electronAPI) {
    _bridge = window.electronAPI
  } else if (window.go?.main?.App) {
    _bridge = createWailsBridge()
  } else {
    _bridge = createBrowserBridge()
  }

  return _bridge
}

export const bridge = getBridge()
