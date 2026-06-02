import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  openXlsx: () => Promise<string | null>
  readFile: (filePath: string) => Promise<ArrayBuffer>
  saveJson: (defaultName: string, jsonData: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  openJson: () => Promise<{ filePath: string; content: string } | null>
  log: (level: string, ...args: unknown[]) => void
}

const api: ElectronAPI = {
  openXlsx: () => ipcRenderer.invoke('file:open'),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  saveJson: (defaultName: string, jsonData: string) =>
    ipcRenderer.invoke('file:save', defaultName, jsonData),
  openJson: () => ipcRenderer.invoke('file:openJson'),
  log: (level: string, ...args: unknown[]) => ipcRenderer.invoke('log', level, ...args),
}

contextBridge.exposeInMainWorld('electronAPI', api)
