import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isSupportedWorkbookPath, MAX_PROJECT_BYTES, MAX_WORKBOOK_BYTES, sanitizeJsonFileName, withTimeout } from './fileSafety'
import { WindowCloseGuard } from './windowCloseGuard'

let mainWindow: BrowserWindow | null = null
const mainWindowCloseGuard = new WindowCloseGuard()
let previewWindow: BrowserWindow | null = null
let isQuitting = false
const previewDataStore = new Map<string, unknown>()
const approvedWorkbookPaths = new Set<string>()
const approvedWorkbookAliases = new Map<string, string>()
const approvedProjectPaths = new Set<string>()
const isElectronE2E = process.env.ELECTRON_E2E === '1'
const showElectronE2EWindows = process.env.ELECTRON_E2E_SHOW_WINDOWS === '1'
const e2eUserDataDirectory = isElectronE2E ? process.env.ELECTRON_E2E_USER_DATA_DIR : undefined
const e2eOpenPaths = (() => {
  if (!isElectronE2E || !process.env.ELECTRON_E2E_OPEN_PATHS) return [] as string[]
  try {
    const value = JSON.parse(process.env.ELECTRON_E2E_OPEN_PATHS)
    return Array.isArray(value) && value.every(path => typeof path === 'string') ? value : []
  } catch {
    return [] as string[]
  }
})()

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
  approvedWorkbookPaths.add(selected)
  return selected
}

async function authorizeProjectSources(content: string, projectPath?: string): Promise<string> {
  const value = JSON.parse(content)
  const workbooks = value?.version === 3 && Array.isArray(value?.project?.workbooks) ? value.project.workbooks : []
  for (const workbook of workbooks) {
    if (!workbook || typeof workbook.sourcePath !== 'string' || !workbook.sourcePath) continue
    const persistedPath = workbook.sourcePath
    const sourcePath = isAbsolute(workbook.sourcePath) || !projectPath
      ? workbook.sourcePath
      : resolve(dirname(projectPath), workbook.sourcePath)
    try {
      approvedWorkbookAliases.set(persistedPath, await approveWorkbook(sourcePath))
    } catch { /* renderer presents reassign/remove actions */ }
  }
  return content
}

function createWindow(): void {
  mainWindowCloseGuard.reset()
  mainWindow = new BrowserWindow({
    frame: false,
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Excel Block Parser',
    show: !isElectronE2E || showElectronE2EWindows,
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

  mainWindow.on('close', (event) => {
    if (!mainWindowCloseGuard.shouldPrompt) return
    event.preventDefault()
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window:close-requested')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    mainWindowCloseGuard.reset()
    if (previewWindow) {
      previewWindow.close()
      previewWindow = null
    }
  })
}

ipcMain.handle('log', (_event, level: string, ...args: unknown[]) => {
  const prefix = `[renderer:${level}]`
  if (level === 'error') console.error(prefix, ...args)
  else if (level === 'warn') console.warn(prefix, ...args)
  else console.log(prefix, ...args)
})

ipcMain.handle('window:minimize', (event) => {
  assertMainWindowSender(event)
  mainWindow?.minimize()
})

ipcMain.handle('window:toggleMaximize', (event) => {
  assertMainWindowSender(event)
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})

ipcMain.handle('window:close', (event) => {
  assertMainWindowSender(event)
  mainWindow?.close()
})

ipcMain.handle('window:confirm-close', (event) => {
  assertMainWindowSender(event)
  mainWindowCloseGuard.confirm()
  mainWindow?.close()
})

ipcMain.handle('file:open', async (event) => {
  assertMainWindowSender(event)
  if (!mainWindow) return null
  if (isElectronE2E && process.env.ELECTRON_E2E_CANCEL_DIALOGS === '1') return null
  if (isElectronE2E && e2eOpenPaths.length) return approveWorkbook(e2eOpenPaths.shift()!)
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
  const filePath = await realpath(approvedWorkbookAliases.get(requestedPath) ?? requestedPath)
  if (!approvedWorkbookPaths.has(filePath)) throw new Error('The workbook must be selected through the Open dialog.')
  const buffer = await readLimitedFile(filePath, MAX_WORKBOOK_BYTES, 'Workbook')
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
})

ipcMain.handle('file:save', async (event, defaultName: unknown, jsonData: unknown) => {
  assertMainWindowSender(event)
  if (!mainWindow) return { success: false, error: 'No window' }
  if (typeof jsonData !== 'string') return { success: false, error: 'Project data must be JSON text.' }
  if (Buffer.byteLength(jsonData, 'utf8') > MAX_PROJECT_BYTES) return { success: false, error: 'Project exceeds the 25 MB limit.' }
  try { JSON.parse(jsonData) } catch { return { success: false, error: 'Project data is not valid JSON.' } }
  if (isElectronE2E && process.env.ELECTRON_E2E_CANCEL_DIALOGS === '1') return { success: false, error: 'Cancelled' }
  const testSavePath = isElectronE2E ? process.env.ELECTRON_E2E_SAVE_PATH : undefined
  const result = testSavePath ? { canceled: false, filePath: testSavePath } : await dialog.showSaveDialog(mainWindow, {
    title: 'Save Project As',
    defaultPath: sanitizeJsonFileName(defaultName, 'project.json'),
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
  try {
    const filePath = resolve(result.filePath)
    await withTimeout(writeFile(filePath, jsonData, 'utf-8'), 'Writing the JSON file timed out after 30 seconds.')
    approvedProjectPaths.add(filePath)
    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to write the JSON file.' }
  }
})

ipcMain.handle('file:writeJson', async (event, requestedPath: unknown, jsonData: unknown) => {
  assertMainWindowSender(event)
  if (typeof requestedPath !== 'string' || typeof jsonData !== 'string') return { success: false, error: 'Invalid project save request.' }
  const filePath = resolve(requestedPath)
  if (!approvedProjectPaths.has(filePath)) return { success: false, error: 'The project must be opened or saved through the application first.' }
  if (Buffer.byteLength(jsonData, 'utf8') > MAX_PROJECT_BYTES) return { success: false, error: 'Project exceeds the 25 MB limit.' }
  try { JSON.parse(jsonData) } catch { return { success: false, error: 'Project data is not valid JSON.' } }
  try {
    await withTimeout(writeFile(filePath, jsonData, 'utf-8'), 'Writing the project file timed out after 30 seconds.')
    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to save the project file.' }
  }
})

ipcMain.handle('file:openJson', async (event) => {
  assertMainWindowSender(event)
  if (!mainWindow) return null
  if (isElectronE2E && process.env.ELECTRON_E2E_CANCEL_DIALOGS === '1') return null
  const testImportPath = isElectronE2E ? process.env.ELECTRON_E2E_IMPORT_PATH : undefined
  const result = testImportPath ? { canceled: false, filePaths: [testImportPath] } : await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  try {
    const filePath = resolve(result.filePaths[0])
    const raw = (await readLimitedFile(filePath, MAX_PROJECT_BYTES, 'Project file')).toString('utf-8')
    approvedWorkbookAliases.clear()
    const content = await authorizeProjectSources(raw, filePath)
    approvedProjectPaths.add(filePath)
    return { filePath, content }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unable to read the project file.')
  }
})

ipcMain.handle('recovery:save', async (event, jsonData: unknown) => {
  assertMainWindowSender(event)
  if (typeof jsonData !== 'string') throw new Error('Recovery data must be JSON text.')
  if (Buffer.byteLength(jsonData, 'utf8') > MAX_PROJECT_BYTES) throw new Error('Recovery data exceeds the 25 MB limit.')
  JSON.parse(jsonData)
  const target = await recoveryPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, jsonData, 'utf-8')
  await rename(temporary, target)
})

ipcMain.handle('recovery:load', async (event) => {
  assertMainWindowSender(event)
  const target = await recoveryPath()
  try {
    const content = (await readLimitedFile(target, MAX_PROJECT_BYTES, 'Recovery data')).toString('utf-8')
    return await authorizeProjectSources(content)
  } catch (error: any) {
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
    show: !isElectronE2E || showElectronE2EWindows,
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
    if (isQuitting || BrowserWindow.getAllWindows().length > 0) return
    createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (previewWindow) previewWindow.close()
  app.quit()
})
