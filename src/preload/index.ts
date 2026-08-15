import { contextBridge, ipcRenderer } from 'electron'
import { bridgeCancelled, bridgeError, bridgeOk, type BridgeResult } from '../shared/bridgeResult'
import type { PythonProjectResult } from '../shared/pythonRuntime'

export interface ElectronAPI {
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
}

const api: ElectronAPI = {
  openXlsx: async () => {
    try {
      const path = await ipcRenderer.invoke('file:open') as string | null
      return path ? bridgeOk(path) : bridgeCancelled()
    } catch (error) { return bridgeError(error) }
  },
  readFile: async (filePath) => {
    try { return bridgeOk(await ipcRenderer.invoke('file:read', filePath) as ArrayBuffer) } catch (error) { return bridgeError(error) }
  },
  saveJson: async (defaultName, jsonData) => {
    try {
      const result = await ipcRenderer.invoke('file:save', defaultName, jsonData) as { success: boolean; filePath?: string; error?: string }
      if (result.success && result.filePath) return bridgeOk({ filePath: result.filePath })
      return result.error?.toLowerCase() === 'cancelled' ? bridgeCancelled() : bridgeError(result.error || 'Unable to save JSON.')
    } catch (error) { return bridgeError(error) }
  },
  saveJsonToPath: async (filePath, jsonData) => {
    try {
      const result = await ipcRenderer.invoke('file:writeJson', filePath, jsonData) as { success: boolean; filePath?: string; error?: string }
      if (result.success && result.filePath) return bridgeOk({ filePath: result.filePath })
      return bridgeError(result.error || 'Unable to save project.')
    } catch (error) { return bridgeError(error) }
  },
  openJson: async () => {
    try {
      const result = await ipcRenderer.invoke('file:openJson') as { filePath: string; content: string } | null
      return result ? bridgeOk(result) : bridgeCancelled()
    } catch (error) { return bridgeError(error) }
  },
  saveRecovery: async (jsonData) => {
    try { await ipcRenderer.invoke('recovery:save', jsonData); return bridgeOk(undefined) } catch (error) { return bridgeError(error) }
  },
  loadRecovery: async () => {
    try { return bridgeOk(await ipcRenderer.invoke('recovery:load') as string | null) } catch (error) { return bridgeError(error) }
  },
  clearRecovery: async () => {
    try { await ipcRenderer.invoke('recovery:clear'); return bridgeOk(undefined) } catch (error) { return bridgeError(error) }
  },
  log: (level: string, ...args: unknown[]) => ipcRenderer.invoke('log', level, ...args),
  openPreviewWindow: (blockId) => ipcRenderer.invoke('preview:open', blockId),
  setPreviewData: (blockId, data) => ipcRenderer.invoke('preview:setData', blockId, data),
  getPreviewData: (blockId) => ipcRenderer.invoke('preview:getData', blockId),
  closePreviewWindow: () => ipcRenderer.invoke('preview:close'),
  onPreviewReload: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, blockId: string) => callback(blockId)
    ipcRenderer.on('preview:reload', handler)
    return () => { ipcRenderer.removeListener('preview:reload', handler) }
  },
  cancelPythonRun: async () => bridgeOk(false),
  runProjectPython: async () => bridgeError('Project Python requires the Wails runtime.'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
