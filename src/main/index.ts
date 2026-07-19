import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSupportedWorkbookPath, MAX_SESSION_BYTES, MAX_WORKBOOK_BYTES, sanitizeJsonFileName, withTimeout } from './fileSafety'

let mainWindow: BrowserWindow | null = null
let previewWindow: BrowserWindow | null = null
const previewDataStore = new Map<string, unknown>()
const approvedWorkbookPaths = new Set<string>()
const isElectronE2E = process.env.ELECTRON_E2E === '1'
const e2eUserDataDirectory = isElectronE2E ? process.env.ELECTRON_E2E_USER_DATA_DIR : undefined

if (e2eUserDataDirectory) app.setPath('userData', e2eUserDataDirectory)

function assertMainWindowSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('This operation is only available from the main application window.')
  }
}

async function readLimitedFile(filePath: string, maxBytes: number, label: string): Promise<Buffer> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`${label} is not a regular file.`)
  if (info.size > maxBytes) throw new Error(`${label} is too large. The limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`)
  return withTimeout(readFile(filePath), `Reading ${label.toLowerCase()} timed out after 30 seconds.`)
}

async function recoveryPath(): Promise<string> {
  const directory = join(app.getPath('userData'), 'recovery')
  await mkdir(directory, { recursive: true })
  return join(directory, 'workspace-session.json')
}

async function approveWorkbook(selectedPath: string): Promise<string> {
  const selected = await realpath(selectedPath)
  if (!isSupportedWorkbookPath(selected)) throw new Error('Select an .xlsx or .xls workbook.')
  const info = await stat(selected)
  if (!info.isFile() || info.size > MAX_WORKBOOK_BYTES) throw new Error('The workbook is unavailable or exceeds the 100 MB limit.')
  approvedWorkbookPaths.clear()
  approvedWorkbookPaths.add(selected)
  return selected
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Excel Block Parser',
    show: !isElectronE2E,
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

ipcMain.handle('file:open', async (event) => {
  assertMainWindowSender(event)
  if (!mainWindow) return null
  if (isElectronE2E && process.env.ELECTRON_E2E_CANCEL_DIALOGS === '1') return null
  if (isElectronE2E && process.env.ELECTRON_E2E_OPEN_PATH) return approveWorkbook(process.env.ELECTRON_E2E_OPEN_PATH)
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Excel File',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return approveWorkbook(result.filePaths[0])
})

ipcMain.handle('file:read', async (event, requestedPath: unknown) => {
  assertMainWindowSender(event)
  if (typeof requestedPath !== 'string') throw new Error('Invalid workbook path.')
  const filePath = await realpath(requestedPath)
  if (!approvedWorkbookPaths.has(filePath)) throw new Error('The workbook must be selected through the Open dialog.')
  const buffer = await readLimitedFile(filePath, MAX_WORKBOOK_BYTES, 'Workbook')
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
})

ipcMain.handle('file:save', async (event, defaultName: unknown, jsonData: unknown) => {
  assertMainWindowSender(event)
  if (!mainWindow) return { success: false, error: 'No window' }
  if (typeof jsonData !== 'string') return { success: false, error: 'Export data must be JSON text.' }
  if (Buffer.byteLength(jsonData, 'utf8') > MAX_SESSION_BYTES) return { success: false, error: 'Export exceeds the 25 MB limit.' }
  try { JSON.parse(jsonData) } catch { return { success: false, error: 'Export data is not valid JSON.' } }
  if (isElectronE2E && process.env.ELECTRON_E2E_CANCEL_DIALOGS === '1') return { success: false, error: 'Cancelled' }
  const testSavePath = isElectronE2E ? process.env.ELECTRON_E2E_SAVE_PATH : undefined
  const result = testSavePath ? { canceled: false, filePath: testSavePath } : await dialog.showSaveDialog(mainWindow, {
    title: 'Save JSON',
    defaultPath: sanitizeJsonFileName(defaultName, 'session.json'),
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
  try {
    await withTimeout(writeFile(result.filePath, jsonData, 'utf-8'), 'Writing the JSON file timed out after 30 seconds.')
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to write the JSON file.' }
  }
})

ipcMain.handle('file:openJson', async (event) => {
  assertMainWindowSender(event)
  if (!mainWindow) return null
  if (isElectronE2E && process.env.ELECTRON_E2E_CANCEL_DIALOGS === '1') return null
  const testImportPath = isElectronE2E ? process.env.ELECTRON_E2E_IMPORT_PATH : undefined
  const result = testImportPath ? { canceled: false, filePaths: [testImportPath] } : await dialog.showOpenDialog(mainWindow, {
    title: 'Import Config',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  try {
    const content = (await readLimitedFile(result.filePaths[0], MAX_SESSION_BYTES, 'Session file')).toString('utf-8')
    return { filePath: result.filePaths[0], content }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unable to read the session file.')
  }
})

ipcMain.handle('recovery:save', async (event, jsonData: unknown) => {
  assertMainWindowSender(event)
  if (typeof jsonData !== 'string') throw new Error('Recovery data must be JSON text.')
  if (Buffer.byteLength(jsonData, 'utf8') > MAX_SESSION_BYTES) throw new Error('Recovery data exceeds the 25 MB limit.')
  JSON.parse(jsonData)
  const target = await recoveryPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, jsonData, 'utf-8')
  await rename(temporary, target)
})

ipcMain.handle('recovery:load', async (event) => {
  assertMainWindowSender(event)
  const target = await recoveryPath()
  try { return (await readLimitedFile(target, MAX_SESSION_BYTES, 'Recovery data')).toString('utf-8') } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw new Error(error instanceof Error ? error.message : 'Unable to read recovery data.')
  }
})

ipcMain.handle('recovery:clear', async (event) => {
  assertMainWindowSender(event)
  try { await unlink(await recoveryPath()) } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
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
    show: !isElectronE2E,
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
