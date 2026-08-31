import { useRef, useEffect, useState } from 'react'
import { Button, Checkbox, Input, Spin, Tooltip, message } from 'antd'
import { CopyOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { setupUniver } from '../univer/setup'
import { useUniver } from '../context/UniverContext'
import type { CellRange } from '../types'
import { convertXlsxToWorkbookData } from '../services/xlsx-converter'
import { getBridge } from '../services/bridge'
import { visibleCanvasRanges } from '../services/canvasRangeVisibility'
import { findWorkbookMatches, formatCellsAsTsv, type WorkbookSearchMatch } from '../services/readOnlyWorkbookTools'
import type { WorkbookLoadRequest } from '../services/workbookRuntime'
import { useI18n } from '../i18n'

interface LockedRangeInfo {
  itemId: string
  range: CellRange
  color: string
  activeSheet?: string | null
}

interface SpreadsheetPanelProps {
  activeSheet: string | null
  activeItemIds: string[]
  activeColumnItemId: string | null
  activeColIndex: number | null
  onSelectionChange: (workbookId: string, range: CellRange | null, activeSheet: string | null) => void
  onActiveSheetChange: (workbookId: string, sheetName: string | null) => void
  loadSignal: number
  requestedWorkbook?: WorkbookLoadRequest | null
  loadedWorkbookId: string | null
  openWorkbookIds: string[]
  onFileLoaded: (workbookId: string, fileName: string, filePath: string, sheetNames: string[], sheetTabColors: Record<string, string>, activeSheetName: string | null) => void
  onLoadedWorkbookChange: (workbookId: string | null) => void
  closeSignal: number
  lockedRanges: LockedRangeInfo[]
  onOpenWorkbook: () => void
}

interface CachedWorkbook {
  unitId: string
  path: string
  sheetNames: string[]
}

interface SearchMatch extends WorkbookSearchMatch {
  sheetName: string
}

export function SpreadsheetPanel({ activeSheet, activeItemIds, activeColumnItemId, activeColIndex, onSelectionChange, onActiveSheetChange, loadSignal, requestedWorkbook, loadedWorkbookId, openWorkbookIds, onFileLoaded, onLoadedWorkbookChange, lockedRanges, closeSignal, onOpenWorkbook }: SpreadsheetPanelProps) {
  const { locale, t } = useI18n()
  const initialLocaleRef = useRef(locale)
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
  const [selection, setSelection] = useState<{ range: CellRange; sheetName: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchWholeCell, setSearchWholeCell] = useState(false)
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const initializedRef = useRef(false)
  const requestedWorkbookRef = useRef<number | null>(null)
  const handledLoadSignalRef = useRef(0)
  const handledRetrySignalRef = useRef(0)
  const loadVersionRef = useRef(0)
  const selectionDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const commandDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const renameObserverRef = useRef<MutationObserver | null>(null)
  const highlightDisposablesRef = useRef<Array<{ dispose: () => void }>>([])
  const workbookCacheRef = useRef<Map<string, CachedWorkbook>>(new Map())

  const copySelection = async () => {
    const api = univerAPIRef.current
    const workbook = api?.getActiveWorkbook()
    const sheet = selection?.sheetName ? workbook?.getSheetByName(selection.sheetName) : workbook?.getActiveSheet()
    if (!sheet || !selection) return
    try {
      const range = sheet.getRange(selection.range.a1Notation)
      const text = formatCellsAsTsv(range.getDisplayValues?.() ?? range.getValues())
      await copyText(text)
      message.success(t('workbook.copySuccess'))
    } catch {
      message.error(t('workbook.copyFailed'))
    }
  }

  const focusSearchMatch = (matches: SearchMatch[], index: number) => {
    const match = matches[index]
    const workbook = univerAPIRef.current?.getActiveWorkbook()
    if (!match || !workbook) return
    const sheet = workbook.getSheetByName(match.sheetName)
    if (!sheet) return
    sheet.activate()
    const range = sheet.getRange(match.range.a1Notation)
    sheet.setActiveSelection?.(range)
    range.activate?.()
    range.scrollTo?.()
    setSearchIndex(index)
  }

  const runSearch = () => {
    const workbook = univerAPIRef.current?.getActiveWorkbook()
    const query = searchQuery.trim()
    if (!workbook || !query) {
      setSearchMatches([])
      setSearchIndex(-1)
      return
    }
    const matches: SearchMatch[] = []
    for (const sheet of workbook.getSheets()) {
      const rowCount = sheet.getMaxRows()
      const columnCount = sheet.getMaxColumns()
      const values = sheet.getRange(0, 0, rowCount, columnCount).getDisplayValues?.() ?? sheet.getRange(0, 0, rowCount, columnCount).getValues()
      for (const match of findWorkbookMatches(values, query, { caseSensitive: searchCaseSensitive, wholeCell: searchWholeCell, maxResults: 250 - matches.length })) {
        matches.push({ ...match, sheetName: sheet.getSheetName() })
      }
      if (matches.length >= 250) break
    }
    setSearchMatches(matches)
    if (matches.length) focusSearchMatch(matches, 0)
    else setSearchIndex(-1)
  }

  useEffect(() => {
    highlightDisposablesRef.current.forEach(d => { try { d.dispose() } catch { /* ignore */ } })
    highlightDisposablesRef.current = []

    const api = univerAPIRef.current
    if (!api || !hasFile || !lockedRanges.length) return

    const workbook = api.getActiveWorkbook()
    if (!workbook) return

    for (const lr of visibleCanvasRanges(lockedRanges, activeItemIds, activeSheet)) {
      const sheet = activeSheet ? workbook.getSheetByName(activeSheet) : workbook.getActiveSheet()
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
  }, [activeSheet, lockedRanges, activeItemIds, hasFile, loadedWorkbookId])

  const colHighlightRef = useRef<{ dispose: () => void } | null>(null)

  useEffect(() => {
    colHighlightRef.current?.dispose()
    colHighlightRef.current = null

    if (activeColIndex == null || !hasFile || !activeColumnItemId) return

    const api = univerAPIRef.current
    if (!api) return
    const workbook = api.getActiveWorkbook()
    if (!workbook) return

    const item = [...lockedRanges].reverse().find(range => range.itemId === activeColumnItemId)
    if (!item) return
    if (item.activeSheet && item.activeSheet !== activeSheet) return

    const sheet = activeSheet ? workbook.getSheetByName(activeSheet) : workbook.getActiveSheet()
    if (!sheet) return

    try {
      const col = activeColIndex
      const r1 = item.range.startRow + 1
      const r2 = item.range.endRow + 1
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
  }, [activeColIndex, activeColumnItemId, activeSheet, hasFile, lockedRanges])

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
          setSelection(null)
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
        setSelection({ range, sheetName: sheetName ?? '' })
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
      setError(t('workbook.containerUnavailable'))
      return
    }

    try {
      initializedRef.current = true

      const { univerAPI: api } = setupUniver(containerRef.current, initialLocaleRef.current)

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
      setError(t('workbook.initFailed', { message: String(err) }))
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

    const doLoad = async (sourceWorkbookId?: string, requestedPath?: string, requestedSheetName?: string | null, forceRefresh = false) => {
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

        const api = univerAPIRef.current
        if (!api) throw new Error(t('workbook.univerUnavailable'))
        const cached = workbookCacheRef.current.get(sourceWorkbookId)
        if (!forceRefresh && cached?.path === filePath) {
          const cachedWorkbook = api.getWorkbook(cached.unitId)
          if (cachedWorkbook) {
            api.setCurrent(cached.unitId)
            if (requestedSheetName) cachedWorkbook.getSheetByName(requestedSheetName)?.activate()
            setHasFile(true)
            setError(null)
            setSheetNames(cached.sheetNames)
            tryAttachListener(cachedWorkbook, sourceWorkbookId)
            onLoadedWorkbookChange(sourceWorkbookId)
            return
          }
          workbookCacheRef.current.delete(sourceWorkbookId)
        }

        setLoading(true)
        setError(null)
        onLoadedWorkbookChange(null)

        const readResult = await withTimeout(bridge.readFile(filePath), t('workbook.readTimedOut'))
        if (readResult.status === 'error') throw new Error(readResult.error.message)
        if (readResult.status === 'cancelled') return
        const arrayBuffer = readResult.value
        const fileName = filePath.split(/[/\\]/).pop() ?? 'workbook.xlsx'

        if (loadVersion !== loadVersionRef.current) return

        selectionDisposableRef.current?.dispose()
        commandDisposableRef.current?.dispose()

        const { workbookData, fonts, sheetTabColors } = await withTimeout(convertXlsxToWorkbookData(arrayBuffer, fileName), t('workbook.convertTimedOut'))

        if (loadVersion !== loadVersionRef.current) return

        const previous = workbookCacheRef.current.get(sourceWorkbookId)
        if (previous) api.disposeUnit(previous.unitId)

        const newWorkbook = api.createWorkbook(workbookData, { makeCurrent: true })
        if (!newWorkbook) throw new Error(t('workbook.createFailed'))
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
        workbookCacheRef.current.set(sourceWorkbookId, {
          unitId: newWorkbook.getId(),
          path: filePath,
          sheetNames: loadedSheetNames,
        })
        setHasFile(true)
        onFileLoaded(sourceWorkbookId, fileName, filePath, loadedSheetNames, sheetTabColors, loadedActiveSheetName)
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
      void doLoad(requestedWorkbook.workbookId, requestedWorkbook.path, requestedWorkbook.sheetName, requestedWorkbook.refresh === true)
    } else {
      if (pickerRequest) handledLoadSignalRef.current = loadSignal
      if (retryRequest) handledRetrySignalRef.current = retrySignal
      void doLoad()
    }
  }, [loadSignal, retrySignal, requestedWorkbook, onFileLoaded, t])

  useEffect(() => {
    const api = univerAPIRef.current
    if (!api) return
    const retained = new Set(openWorkbookIds)
    for (const [workbookId, cached] of workbookCacheRef.current) {
      if (retained.has(workbookId)) continue
      api.disposeUnit(cached.unitId)
      workbookCacheRef.current.delete(workbookId)
    }
  }, [openWorkbookIds])

  useEffect(() => {
    if (closeSignal === 0) return
    const api = univerAPIRef.current
    if (!api) return
    for (const cached of workbookCacheRef.current.values()) api.disposeUnit(cached.unitId)
    workbookCacheRef.current.clear()
    setHasFile(false)
    setSelection(null)
    setSearchMatches([])
    setSearchIndex(-1)
    setSheetNames([])
    onLoadedWorkbookChange(null)
    setError(null)
  }, [closeSignal, setSheetNames])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {hasFile && (
        <div className="workbook-readonly-tools" aria-label={t('workbook.readonlyTools')}>
          <Tooltip title={t('workbook.copySelection')}>
            <Button aria-label={t('workbook.copySelection')} type="text" size="small" icon={<CopyOutlined />} disabled={!selection} onClick={() => void copySelection()} />
          </Tooltip>
          <Tooltip title={t('workbook.search')}>
            <Button aria-label={t('workbook.search')} type="text" size="small" icon={<SearchOutlined />} onClick={() => setSearchOpen(current => !current)} />
          </Tooltip>
        </div>
      )}
      {hasFile && searchOpen && (
        <div className="workbook-search" role="search">
          <Input size="small" autoFocus value={searchQuery} placeholder={t('workbook.searchPlaceholder')}
            onChange={event => setSearchQuery(event.target.value)} onPressEnter={runSearch} suffix={<SearchOutlined />} />
          <div className="workbook-search-options">
            <Checkbox checked={searchCaseSensitive} onChange={event => setSearchCaseSensitive(event.target.checked)}>{t('workbook.searchCaseSensitive')}</Checkbox>
            <Checkbox checked={searchWholeCell} onChange={event => setSearchWholeCell(event.target.checked)}>{t('workbook.searchWholeCell')}</Checkbox>
            <span className="workbook-search-count">{searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : ''}</span>
            <Button aria-label={t('workbook.searchPrevious')} type="text" size="small" icon={<LeftOutlined />} disabled={!searchMatches.length}
              onClick={() => focusSearchMatch(searchMatches, (searchIndex - 1 + searchMatches.length) % searchMatches.length)} />
            <Button aria-label={t('workbook.searchNext')} type="text" size="small" icon={<RightOutlined />} disabled={!searchMatches.length}
              onClick={() => focusSearchMatch(searchMatches, (searchIndex + 1) % searchMatches.length)} />
          </div>
        </div>
      )}
      {!hasFile && !error && !loading && (
        <div className="workbook-empty-state">
          <div className="workbook-empty-icon">XLSX</div>
          <strong>{t('workbook.openBegin')}</strong>
          <span>{t('workbook.openHint')}</span>
          <Button type="primary" onClick={onOpenWorkbook}>{t('workbook.open')}</Button>
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
          <Button onClick={onOpenWorkbook}>{t('workbook.chooseAnother')}</Button>
        </div>
      )}
    </div>
  )
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard access was denied')
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
