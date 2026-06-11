import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null
let previewWindow: BrowserWindow | null = null
const previewDataStore = new Map<string, unknown>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Excel Block Parser',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: process.env.NODE_ENV !== 'production',
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('log', (_event, level: string, ...args: unknown[]) => {
  const prefix = `[renderer:${level}]`
  if (level === 'error') console.error(prefix, ...args)
  else if (level === 'warn') console.warn(prefix, ...args)
  else console.log(prefix, ...args)
})

ipcMain.handle('file:open', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Excel File',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('file:read', async (_event, filePath: string) => {
  const buffer = await readFile(filePath)
  return buffer.buffer
})

ipcMain.handle('file:save', async (_event, defaultName: string, jsonData: string) => {
  if (!mainWindow) return { success: false, error: 'No window' }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save JSON',
    defaultPath: defaultName,
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
  await writeFile(result.filePath, jsonData, 'utf-8')
  return { success: true, filePath: result.filePath }
})

ipcMain.handle('file:openJson', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Config',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  try {
    const content = await readFile(result.filePaths[0], 'utf-8')
    return { filePath: result.filePaths[0], content }
  } catch {
    return null
  }
})

ipcMain.handle('preview:open', (_event, blockId: string) => {
  if (previewWindow) {
    previewWindow.focus()
    previewWindow.webContents.send('preview:reload', blockId)
    return
  }

  previewWindow = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 700,
    minHeight: 400,
    title: 'Preview',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const encodedBlock = encodeURIComponent(blockId)
  const previewUrl = process.env.ELECTRON_RENDERER_URL
    ? `${process.env.ELECTRON_RENDERER_URL}?preview=true&block=${encodedBlock}`
    : `file://${join(__dirname, '../renderer/index.html')}?preview=true&block=${encodedBlock}`

  previewWindow.loadURL(previewUrl)

  previewWindow.on('closed', () => {
    previewWindow = null
    previewDataStore.clear()
  })
})

ipcMain.handle('preview:setData', (_event, blockId: string, data: unknown) => {
  previewDataStore.set(blockId, data)
})

ipcMain.handle('preview:getData', (_event, blockId: string) => {
  return previewDataStore.get(blockId)
})

ipcMain.handle('preview:close', () => {
  if (previewWindow) {
    previewWindow.close()
  }
  previewWindow = null
  previewDataStore.clear()
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (previewWindow) previewWindow.close()
  if (process.platform !== 'darwin') app.quit()
})
