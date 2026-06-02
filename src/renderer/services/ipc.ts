export interface ElectronAPI {
  openXlsx: () => Promise<string | null>
  readFile: (filePath: string) => Promise<ArrayBuffer>
  saveJson: (defaultName: string, jsonData: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
  openJson: () => Promise<{ filePath: string; content: string } | null>
  log: (level: string, ...args: unknown[]) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
