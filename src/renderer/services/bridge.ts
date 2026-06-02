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
  log: (level: string, ...args: unknown[]) => void
}

// ── Wails bridge ────────────────────────────────────────────────────────────

interface WailsGoAPI {
  main?: {
    App?: {
      OpenXlsx: () => Promise<string>
      ReadFile: (path: string) => Promise<number[]>
      SaveJson: (name: string, data: string) => Promise<{ success: boolean; filePath: string; error: string }>
      OpenJson: () => Promise<{ filePath: string; content: string } | null>
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
    log: (level: string, ...args: unknown[]) => {
      console.log(`[${level}]`, ...args)
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
    log: (level, ...args) => { console.log(`[${level}]`, ...args) },
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
