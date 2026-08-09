import { useRef, useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import { setupUniver } from '../univer/setup'
import { useUniver } from '../context/UniverContext'
import type { CellRange } from '../types'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import { getBridge } from '../services/bridge'

interface LockedRangeInfo {
  blockId: string
  range: CellRange
  color: string
  activeSheet?: string | null
}

interface SpreadsheetPanelProps {
  activeBlockId: string
  activeRegionId: string | null
  activeColIndex: number | null
  onSelectionChange: (workbookId: string, range: CellRange | null, activeSheet: string | null) => void
  onActiveSheetChange: (workbookId: string, sheetName: string | null) => void
  loadSignal: number
  requestedWorkbook?: { workbookId: string; path: string; requestId: number; sheetName?: string | null } | null
  onFileLoaded: (workbookId: string, fileName: string, filePath: string, sheetNames: string[], activeSheetName: string | null) => void
  onLoadedWorkbookChange: (workbookId: string | null) => void
  closeSignal: number
  lockedRanges: LockedRangeInfo[]
  onOpenWorkbook: () => void
}

export function SpreadsheetPanel({ activeBlockId, activeRegionId, activeColIndex, onSelectionChange, onActiveSheetChange, loadSignal, requestedWorkbook, onFileLoaded, onLoadedWorkbookChange, lockedRanges, closeSignal, onOpenWorkbook }: SpreadsheetPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { univerAPI, setUniverAPI, setSheetNames } = useUniver()
  const univerAPIRef = useRef(univerAPI)
  univerAPIRef.current = univerAPI

  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const onActiveSheetChangeRef = useRef(onActiveSheetChange)
  onActiveSheetChangeRef.current = onActiveSheetChange

  const refreshSheetNames = (targetWorkbook?: any) => {
    const api = univerAPIRef.current
    if (!api) return
    const wb = targetWorkbook ?? api.getActiveWorkbook()
    if (!wb) return
    const sheets: string[] = []
    const facadeSheets = wb.getSheets()
    if (facadeSheets) {
      for (const s of facadeSheets) {
        sheets.push(s.getSheetName())
      }
    }
    setSheetNames(sheets)
  }

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasFile, setHasFile] = useState(false)
  const [retrySignal, setRetrySignal] = useState(0)
  const initializedRef = useRef(false)
  const requestedWorkbookRef = useRef<number | null>(null)
  const handledLoadSignalRef = useRef(0)
  const handledRetrySignalRef = useRef(0)
  const loadVersionRef = useRef(0)
  const selectionDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const commandDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const renameObserverRef = useRef<MutationObserver | null>(null)
  const highlightDisposablesRef = useRef<Array<{ dispose: () => void }>>([])

  useEffect(() => {
    highlightDisposablesRef.current.forEach(d => { try { d.dispose() } catch { /* ignore */ } })
    highlightDisposablesRef.current = []

    const api = univerAPIRef.current
    if (!api || !hasFile || !lockedRanges.length) return

    const workbook = api.getActiveWorkbook()
    if (!workbook) return

    for (const lr of lockedRanges) {
      if (lr.blockId !== activeBlockId && lr.blockId !== activeRegionId) continue

      const sheet = lr.activeSheet ? workbook.getSheetByName(lr.activeSheet) : workbook.getActiveSheet()
      if (!sheet) continue

      try {
        const frange = sheet.getRange(lr.range.a1Notation)
        const disposable = sheet.highlightRanges([frange], {
          stroke: lr.color,
          strokeWidth: 3,
          fill: 'rgba(22, 119, 255, 0.06)',
        })
        if (disposable) highlightDisposablesRef.current.push(disposable)
      } catch { /* ignore */ }
    }

    return () => {
      highlightDisposablesRef.current.forEach(d => { try { d.dispose() } catch { /* ignore */ } })
      highlightDisposablesRef.current = []
    }
  }, [lockedRanges, activeBlockId, activeRegionId, hasFile])

  const colHighlightRef = useRef<{ dispose: () => void } | null>(null)

  useEffect(() => {
    colHighlightRef.current?.dispose()
    colHighlightRef.current = null

    if (activeColIndex == null || !hasFile || !activeBlockId) return

    const api = univerAPIRef.current
    if (!api) return
    const workbook = api.getActiveWorkbook()
    if (!workbook) return

    const block = [...lockedRanges].reverse().find(lr => lr.blockId === activeBlockId)
    if (!block) return

    const sheet = block.activeSheet ? workbook.getSheetByName(block.activeSheet) : workbook.getActiveSheet()
    if (!sheet) return

    try {
      const col = activeColIndex
      const r1 = block.range.startRow + 1
      const r2 = block.range.endRow + 1
      const a1 = `${colToA1(col)}${r1}:${colToA1(col)}${r2}`
      const frange = sheet.getRange(a1)
      colHighlightRef.current = sheet.highlightRanges([frange], {
        stroke: '#fa8c16',
        strokeWidth: 2,
        fill: 'rgba(250, 140, 22, 0.04)',
      })
    } catch { /* ignore */ }

    return () => {
      colHighlightRef.current?.dispose()
      colHighlightRef.current = null
    }
  }, [activeColIndex, activeBlockId, hasFile, lockedRanges])

  const tryAttachListener = (targetWorkbook: any, sourceWorkbookId: string) => {
    try {
      selectionDisposableRef.current?.dispose()
      commandDisposableRef.current?.dispose()
      const api = univerAPIRef.current
      if (!api) return

      const workbook = targetWorkbook ?? api.getActiveWorkbook()
      if (!workbook) return

      const disposable = workbook.onSelectionChange((selections: any[]) => {
        const currentSheet = workbook.getActiveSheet()
        const sheetName = currentSheet?.getSheetName() ?? null

        if (!selections.length || !currentSheet) {
          onSelectionChangeRef.current(sourceWorkbookId, null, sheetName)
          return
        }
        const sel = selections[0]
        const range: CellRange = {
          startRow: sel.startRow,
          startCol: sel.startColumn,
          endRow: sel.endRow,
          endCol: sel.endColumn,
          a1Notation: `${colToA1(sel.startColumn)}${sel.startRow + 1}:${colToA1(sel.endColumn)}${sel.endRow + 1}`,
        }
        onSelectionChangeRef.current(sourceWorkbookId, range, sheetName)
      })

      selectionDisposableRef.current = disposable

      commandDisposableRef.current = workbook.onCommandExecuted((command: any) => {
        const commandId = (command as any)?.id?.toLowerCase() || ''
        if (commandId.includes('set-worksheet-active') || commandId.includes('set-worksheet-activate')) {
          const sheetName = workbook.getActiveSheet()?.getSheetName() ?? null
          onActiveSheetChangeRef.current(sourceWorkbookId, sheetName)
        }
        if (commandId.includes('sheet') || commandId.includes('worksheet')) {
          setTimeout(() => refreshSheetNames(workbook), 50)
        }
      })

      setTimeout(() => refreshSheetNames(workbook), 50)
    } catch { /* selection listener setup failed, non-fatal */ }
  }

  useEffect(() => {
    if (initializedRef.current) return
    if (!containerRef.current) {
      setError('Container element not found — cannot initialize Univer')
      return
    }

    try {
      initializedRef.current = true

      const { univerAPI: api } = setupUniver(containerRef.current)

      api.addEvent(api.Event.BeforeCommandExecute, (event) => {
        const eid = event.id.toLowerCase()
        if (eid.includes('edit') || eid.includes('clear') || eid.includes('delete') ||
            eid.includes('paste') || eid.includes('set-range') || eid.includes('setcell') ||
            eid.includes('fill') || eid.includes('drag') || eid.includes('resize') ||
            eid.includes('insert') || eid.includes('auto-fill')) {
          event.cancel = true
        }
      })

      univerAPIRef.current = api
      setUniverAPI(api)

      // Prevent sheet name double-click rename: the SlideTabBar uses internal
      // click-timing (not native dblclick), so we watch for contentEditable
      // being set on the tab name span and immediately revert it
      const renameObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'contenteditable') {
            const el = m.target as HTMLElement
            if (el.closest('[data-u-comp="slide-tab-item"]') && el.getAttribute('contenteditable') === 'true') {
              requestAnimationFrame(() => {
                el.removeAttribute('contenteditable')
                el.blur()
              })
            }
          }
        }
      })
      renameObserver.observe(containerRef.current!, {
        attributes: true,
        attributeFilter: ['contenteditable'],
        subtree: true,
      })
      renameObserverRef.current = renameObserver

      // Read-only permissions on workbook loaded
      api.addEvent(api.Event.LifeCycleChanged, ({ stage }: any) => {
        if (stage === api.Enum?.LifecycleStages?.Rendered) {
          setTimeout(() => {
            const wb = univerAPIRef.current?.getActiveWorkbook()
            if (wb) {
              wb.getWorkbookPermission().setReadOnly().catch(() => {})
              wb.getWorkbookPermission().setPermissionDialogVisible(false)
            }
          }, 0)
        }
      })

      setTimeout(() => refreshSheetNames(), 100)
    } catch (err) {
      setError(`Univer init failed: ${String(err)}`)
    }

    return () => {
      selectionDisposableRef.current?.dispose()
      commandDisposableRef.current?.dispose()
      renameObserverRef.current?.disconnect()
      try { univerAPIRef.current?.dispose() } catch { /* teardown */ }
      initializedRef.current = false
    }
  }, [])

  useEffect(() => {
    const externalRequest = requestedWorkbook && requestedWorkbook.requestId !== requestedWorkbookRef.current
    const pickerRequest = loadSignal !== 0 && loadSignal !== handledLoadSignalRef.current
    const retryRequest = retrySignal !== 0 && retrySignal !== handledRetrySignalRef.current
    if (!externalRequest && !pickerRequest && !retryRequest) return

    const doLoad = async (sourceWorkbookId?: string, requestedPath?: string, requestedSheetName?: string | null) => {
      const loadVersion = ++loadVersionRef.current
      try {
        const bridge = getBridge()
        let filePath = requestedPath
        if (!filePath) {
          const openResult = await bridge.openXlsx()
          if (openResult.status === 'cancelled') return
          if (openResult.status === 'error') throw new Error(openResult.error.message)
          filePath = openResult.value
        }
        if (!filePath || !sourceWorkbookId) return

        setLoading(true)
        setError(null)
        onLoadedWorkbookChange(null)

        const readResult = await withTimeout(bridge.readFile(filePath), 'Reading the workbook timed out after 30 seconds.')
        if (readResult.status === 'error') throw new Error(readResult.error.message)
        if (readResult.status === 'cancelled') return
        const arrayBuffer = readResult.value
        const fileName = filePath.split(/[/\\]/).pop() ?? 'workbook.xlsx'

        if (loadVersion !== loadVersionRef.current) return

        const api = univerAPIRef.current
        if (!api) throw new Error('Univer API not initialized')

        selectionDisposableRef.current?.dispose()
        commandDisposableRef.current?.dispose()
        const activeWorkbook = api.getActiveWorkbook()
        if (activeWorkbook) api.disposeUnit(activeWorkbook.getId())

        const { workbookData, fonts } = await withTimeout(convertXlsxToWorkbookData(arrayBuffer, fileName), 'Converting the workbook timed out after 30 seconds.')

        if (loadVersion !== loadVersionRef.current) return

        const newWorkbook = api.createWorkbook(workbookData, { makeCurrent: true })
        if (!newWorkbook) throw new Error('createWorkbook failed')
        if (requestedSheetName) newWorkbook.getSheetByName(requestedSheetName)?.activate()

        setTimeout(() => {
          try {
            newWorkbook.getWorkbookPermission().setReadOnly().catch(() => {})
            newWorkbook.getWorkbookPermission().setPermissionDialogVisible(false)
          } catch { /* permission set may fail during init */ }
        }, 0)

        if (fonts.length > 0) {
          try { api.addFonts(fonts.map(f => ({ value: f, label: f }))) } catch { /* font may already exist */ }
        }

        const loadedSheetNames = newWorkbook.getSheets().map(sheet => sheet.getSheetName())
        const loadedActiveSheetName = newWorkbook.getActiveSheet()?.getSheetName() ?? null
        setHasFile(true)
        onFileLoaded(sourceWorkbookId, fileName, filePath, loadedSheetNames, loadedActiveSheetName)
        onLoadedWorkbookChange(sourceWorkbookId)

        setSheetNames(loadedSheetNames)
        tryAttachListener(newWorkbook, sourceWorkbookId)
      } catch (err) {
        const msg = String(err)
        console.error('[SpreadsheetPanel] Load error:', msg)
        if (err instanceof Error && err.stack) console.error(err.stack)
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    if (externalRequest && requestedWorkbook) {
      requestedWorkbookRef.current = requestedWorkbook.requestId
      void doLoad(requestedWorkbook.workbookId, requestedWorkbook.path, requestedWorkbook.sheetName)
    } else {
      if (pickerRequest) handledLoadSignalRef.current = loadSignal
      if (retryRequest) handledRetrySignalRef.current = retrySignal
      void doLoad()
    }
  }, [loadSignal, retrySignal, requestedWorkbook, onFileLoaded])

  useEffect(() => {
    if (closeSignal === 0) return
    const api = univerAPIRef.current
    if (!api) return
    const wb = api.getActiveWorkbook()
    if (wb) api.disposeUnit(wb.getId())
    setHasFile(false)
    setSheetNames([])
    onLoadedWorkbookChange(null)
    setError(null)
  }, [closeSignal, setSheetNames])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!hasFile && !error && !loading && (
        <div className="workbook-empty-state">
          <div className="workbook-empty-icon">XLSX</div>
          <strong>Open a workbook to begin</strong>
          <span>Select an Excel file, then choose the ranges you want to turn into structured data.</span>
          <Button type="primary" onClick={onOpenWorkbook}>Open workbook</Button>
        </div>
      )}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(255,255,255,0.8)' }}>
          <Spin size="large" />
        </div>
      )}
      {error && (
        <div role="alert" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#cf1322', fontSize: 14, padding: 24, textAlign: 'center' }}>
          <span>{error}</span>
          <Button onClick={onOpenWorkbook}>Choose another workbook</Button>
        </div>
      )}
    </div>
  )
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 30_000) })
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

function colToA1(col: number): string {
  let letter = ''
  let n = col
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}
