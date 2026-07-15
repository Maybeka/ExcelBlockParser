import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
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

const api: ElectronAPI = {
  openXlsx: () => ipcRenderer.invoke('file:open'),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  saveJson: (defaultName: string, jsonData: string) =>
    ipcRenderer.invoke('file:save', defaultName, jsonData),
  openJson: () => ipcRenderer.invoke('file:openJson'),
  saveRecovery: (jsonData) => ipcRenderer.invoke('recovery:save', jsonData),
  loadRecovery: () => ipcRenderer.invoke('recovery:load'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),
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
}

contextBridge.exposeInMainWorld('electronAPI', api)
