import { useRef, useEffect, useState } from 'react'
import { Spin } from 'antd'
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
  activeColIndex: number | null
  onSelectionChange: (range: CellRange | null, activeSheet: string | null) => void
  loadSignal: number
  onFileLoaded: (fileName: string) => void
  closeSignal: number
  lockedRanges: LockedRangeInfo[]
}

export function SpreadsheetPanel({ activeBlockId, activeColIndex, onSelectionChange, loadSignal, onFileLoaded, lockedRanges, closeSignal }: SpreadsheetPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { univerAPI, setUniverAPI, setSheetNames } = useUniver()
  const univerAPIRef = useRef(univerAPI)
  univerAPIRef.current = univerAPI

  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange

  const refreshSheetNames = () => {
    const api = univerAPIRef.current
    if (!api) return
    const wb = api.getActiveWorkbook()
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
  const initializedRef = useRef(false)
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
      if (lr.blockId !== activeBlockId) continue

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
  }, [lockedRanges, activeBlockId, hasFile])

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

  const tryAttachListener = () => {
    try {
      selectionDisposableRef.current?.dispose()
      const api = univerAPIRef.current
      if (!api) return

      const workbook = api.getActiveWorkbook()
      if (!workbook) return

      const disposable = workbook.onSelectionChange((selections) => {
        const currentSheet = workbook.getActiveSheet()
        const sheetName = currentSheet?.getSheetName() ?? null

        if (!selections.length || !currentSheet) {
          onSelectionChangeRef.current(null, sheetName)
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
        onSelectionChangeRef.current(range, sheetName)
      })

      selectionDisposableRef.current = disposable

      setTimeout(() => refreshSheetNames(), 50)
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

      const workbook = api.getActiveWorkbook()
      if (workbook) {
        const cmdDisposable = workbook.onCommandExecuted((command) => {
          const cmdId = (command as any)?.id?.toLowerCase() || ''
          if (cmdId.includes('sheet') || cmdId.includes('worksheet')) {
            setTimeout(() => refreshSheetNames(), 50)
            onSelectionChangeRef.current(null, null)
          }
        })
        commandDisposableRef.current = cmdDisposable
      }

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
    if (loadSignal === 0) return

    const doLoad = async () => {
      try {
        const bridge = getBridge()
        const filePath = await bridge.openXlsx()
        if (!filePath) return

        setLoading(true)
        setError(null)

        const arrayBuffer = await bridge.readFile(filePath)
        const fileName = filePath.split(/[/\\]/).pop() ?? 'workbook.xlsx'

        const api = univerAPIRef.current
        if (!api) throw new Error('Univer API not initialized')

        const activeWorkbook = api.getActiveWorkbook()
        if (activeWorkbook) api.disposeUnit(activeWorkbook.getId())

        const { workbookData, fonts } = await convertXlsxToWorkbookData(arrayBuffer, fileName)

        const newWorkbook = api.createWorkbook(workbookData)
        if (!newWorkbook) throw new Error('createWorkbook failed')

        setTimeout(() => {
          try {
            const activeWb = univerAPIRef.current?.getActiveWorkbook()
            if (activeWb) {
              activeWb.getWorkbookPermission().setReadOnly().catch(() => {})
              activeWb.getWorkbookPermission().setPermissionDialogVisible(false)
            }
          } catch { /* permission set may fail during init */ }
        }, 0)

        if (fonts.length > 0) {
          try { api.addFonts(fonts.map(f => ({ value: f, label: f }))) } catch { /* font may already exist */ }
        }

        setHasFile(true)
        onSelectionChangeRef.current(null, null)
        onFileLoaded(fileName)

        setTimeout(() => refreshSheetNames(), 200)
        setTimeout(() => tryAttachListener(), 300)
      } catch (err) {
        const msg = String(err)
        console.error('[SpreadsheetPanel] Load error:', msg)
        if (err instanceof Error && err.stack) console.error(err.stack)
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    doLoad()
  }, [loadSignal])

  useEffect(() => {
    if (closeSignal === 0) return
    const api = univerAPIRef.current
    if (!api) return
    const wb = api.getActiveWorkbook()
    if (wb) api.disposeUnit(wb.getId())
    setHasFile(false)
    setError(null)
  }, [closeSignal])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!hasFile && !error && !loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14, pointerEvents: 'none' }}>
          Open an XLSX file to get started
        </div>
      )}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(255,255,255,0.8)' }}>
          <Spin size="large" />
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff4d4f', fontSize: 14 }}>
          {error}
        </div>
      )}
    </div>
  )
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
