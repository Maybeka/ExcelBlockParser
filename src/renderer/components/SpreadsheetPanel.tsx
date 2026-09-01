import { useRef, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button, Checkbox, Input, Popover, Spin, Tooltip, message, type InputRef } from 'antd'
import { CloseOutlined, CompressOutlined, CopyOutlined, LeftOutlined, MinusSquareOutlined, PlusSquareOutlined, PushpinOutlined, RightOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { setupUniver } from '../univer/setup'
import { useUniver } from '../context/UniverContext'
import { DEFAULT_WORKBOOK_DISPLAY_SETTINGS, type CellRange, type WorkbookDisplaySettings } from '../types'
import { convertXlsxToWorkbookData, type SheetDisplaySettings, type SheetOutlineGroup } from '../services/xlsx-converter'
import { getBridge } from '../services/bridge'
import { visibleCanvasRanges } from '../services/canvasRangeVisibility'
import { findMatchesInSheets, formatCellsAsTsv, type WorkbookSearchMatch } from '../services/readOnlyWorkbookTools'
import { workbookCacheEvictions } from '../services/workbookCachePolicy'
import type { WorkbookLoadRequest } from '../services/workbookRuntime'
import { useI18n } from '../i18n'

interface LockedRangeInfo {
  itemId: string
  range: CellRange
  color: string
  activeSheet?: string | null
}

interface SpreadsheetPanelProps {
  activeWorkbookId: string | null
  activeSheet: string | null
  displaySettings: WorkbookDisplaySettings
  onDisplaySettingsChange: (settings: WorkbookDisplaySettings) => void
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
  toolbarContainer?: HTMLElement | null
  onSuccessNotice?: (text: string, duration: number) => void
  focusRange?: (sheetName: string | null, range: CellRange) => boolean
}

interface CachedWorkbook {
  unitId: string
  path: string
  sheetNames: string[]
  sheetDisplaySettings: Record<string, SheetDisplaySettings>
  lastUsed: number
}

interface SearchMatch extends WorkbookSearchMatch {
  sheetName: string
}

export function SpreadsheetPanel({ activeWorkbookId, activeSheet, displaySettings, onDisplaySettingsChange, activeItemIds, activeColumnItemId, activeColIndex, onSelectionChange, onActiveSheetChange, loadSignal, requestedWorkbook, loadedWorkbookId, openWorkbookIds, onFileLoaded, onLoadedWorkbookChange, lockedRanges, closeSignal, onOpenWorkbook, toolbarContainer, onSuccessNotice, focusRange }: SpreadsheetPanelProps) {
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
  const focusRangeRef = useRef(focusRange)
  focusRangeRef.current = focusRange

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
  const [searchAllSheets, setSearchAllSheets] = useState(false)
  const { showOutlines, showFrozenPanes } = displaySettings ?? DEFAULT_WORKBOOK_DISPLAY_SETTINGS
  const displayModesRef = useRef({ showOutlines, showFrozenPanes })
  displayModesRef.current = { showOutlines, showFrozenPanes }
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const [searchRan, setSearchRan] = useState(false)
  const searchInputRef = useRef<InputRef>(null)
  const searchPanelRef = useRef<HTMLDivElement>(null)
  const searchPositionRef = useRef({ left: 16, top: 52 })
  const searchDragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const searchPlacedRef = useRef(false)
  const lastSearchKeyRef = useRef('')
  const copySelectionRef = useRef<() => Promise<void>>(async () => {})
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
  const cacheAccessCounterRef = useRef(0)
  const outlineCollapsedRef = useRef<Map<string, Map<string, boolean>>>(new Map())
  const [outlineRevision, setOutlineRevision] = useState(0)

  const outlineStateFor = (workbookId: string, sheetName: string, group: SheetOutlineGroup): boolean => {
    let workbookStates = outlineCollapsedRef.current.get(workbookId)
    if (!workbookStates) {
      workbookStates = new Map()
      outlineCollapsedRef.current.set(workbookId, workbookStates)
    }
    const key = `${sheetName}:${group.id}`
    if (!workbookStates.has(key)) workbookStates.set(key, group.initialCollapsed)
    return workbookStates.get(key) ?? group.initialCollapsed
  }

  const touchCachedWorkbook = (cached: CachedWorkbook) => {
    cached.lastUsed = ++cacheAccessCounterRef.current
  }

  const releaseExcessCachedWorkbooks = (activeId: string) => {
    const api = univerAPIRef.current
    if (!api) return
    const evictions = workbookCacheEvictions(
      [...workbookCacheRef.current].map(([id, cached]) => ({ id, lastUsed: cached.lastUsed })),
      activeId,
    )
    for (const workbookId of evictions) {
      const cached = workbookCacheRef.current.get(workbookId)
      if (!cached) continue
      api.disposeUnit(cached.unitId)
      workbookCacheRef.current.delete(workbookId)
      outlineCollapsedRef.current.delete(workbookId)
    }
  }

  const applyDisplayModes = (workbook: any, settings: Record<string, SheetDisplaySettings>, workbookId: string) => {
    const displayModes = displayModesRef.current
    for (const [sheetName, sheetSettings] of Object.entries(settings)) {
      const sheet = workbook.getSheetByName(sheetName)
      if (!sheet) continue
      try {
        if (displayModes.showFrozenPanes && sheetSettings.freeze) sheet.setFreeze(sheetSettings.freeze)
        else sheet.cancelFreeze()

        applyOutlineGroups(sheet, sheetSettings, displayModes.showOutlines, workbookId, sheetName, outlineStateFor)
      } catch {
        // Display preferences are non-destructive; an individual sheet may not
        // be ready while Univer is constructing the workbook.
      }
    }
  }

  const copySelection = async () => {
    const api = univerAPIRef.current
    const workbook = api?.getActiveWorkbook()
    const sheet = selection?.sheetName ? workbook?.getSheetByName(selection.sheetName) : workbook?.getActiveSheet()
    if (!sheet || !selection) return
    try {
      const range = sheet.getRange(selection.range.a1Notation)
      const text = formatCellsAsTsv(range.getDisplayValues?.() ?? range.getValues())
      await copyText(text)
      onSuccessNotice?.(t('workbook.copySuccess'), 1000)
    } catch {
      message.error(t('workbook.copyFailed'))
    }
  }
  copySelectionRef.current = copySelection

  const searchKey = () => [searchQuery.trim(), searchCaseSensitive, searchWholeCell, searchAllSheets].join('|')

  const focusSearchMatch = (matches: SearchMatch[], index: number) => {
    const match = matches[index]
    const workbook = univerAPIRef.current?.getActiveWorkbook()
    if (!match || !workbook) return
    const sheet = workbook.getSheetByName(match.sheetName)
    if (!sheet) return
    if (loadedWorkbookId) onActiveSheetChangeRef.current(loadedWorkbookId, match.sheetName)
    focusRangeRef.current?.(match.sheetName, match.range)
    const range = sheet.getRange(match.range.a1Notation)
    sheet.setActiveSelection?.(range)
    range.activate?.()
    setSearchIndex(index)
  }

  const runSearch = () => {
    const workbook = univerAPIRef.current?.getActiveWorkbook()
    const query = searchQuery.trim()
    if (!workbook || !query) {
      setSearchMatches([])
      setSearchIndex(-1)
      setSearchRan(false)
      lastSearchKeyRef.current = ''
      return
    }
    const sheets = (searchAllSheets ? workbook.getSheets() : [workbook.getActiveSheet()]).flatMap(sheet => {
      if (!sheet) return []
      // getMaxRows/getMaxColumns describe the full grid, not populated cells.
      // Reading that grid can allocate millions of empty values for a small
      // workbook, so search only the sheet's actual data range.
      const dataRange = sheet.getDataRange()
      const values = dataRange.getDisplayValues?.() ?? dataRange.getValues()
      return [{ name: sheet.getSheetName(), values }]
    })
    const matches = findMatchesInSheets(sheets, query, { caseSensitive: searchCaseSensitive, wholeCell: searchWholeCell })
    setSearchMatches(matches)
    setSearchRan(true)
    lastSearchKeyRef.current = searchKey()
    if (matches.length) focusSearchMatch(matches, 0)
    else setSearchIndex(-1)
  }

  const runOrAdvanceSearch = () => {
    if (searchMatches.length && lastSearchKeyRef.current === searchKey()) {
      focusSearchMatch(searchMatches, (searchIndex + 1) % searchMatches.length)
      return
    }
    runSearch()
  }

  const applySearchPosition = (left: number, top: number) => {
    const panel = searchPanelRef.current
    const next = clampFloatingPanelPosition(
      { left, top },
      { width: panel?.offsetWidth || 220, height: panel?.offsetHeight || 42 },
      { width: window.innerWidth, height: window.innerHeight },
    )
    searchPositionRef.current = next
    if (panel) {
      panel.style.left = `${next.left}px`
      panel.style.top = `${next.top}px`
    }
  }

  const beginSearchDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const panel = searchPanelRef.current
    if (!panel) return
    event.preventDefault()
    const rect = panel.getBoundingClientRect()
    searchDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveSearchPanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = searchDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applySearchPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
  }

  const endSearchDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (searchDragRef.current?.pointerId !== event.pointerId) return
    searchDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const onResize = () => {
      const current = searchPositionRef.current
      applySearchPosition(current.left, current.top)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const openWorkbookSearch = () => {
    setSearchOpen(true)
    window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0)
  }

  useEffect(() => {
    if (!searchOpen) return
    if (!searchPlacedRef.current) {
      searchPlacedRef.current = true
      const origin = containerRef.current?.closest('.workspace-canvas')?.getBoundingClientRect()
      applySearchPosition((origin?.left ?? 16) + 16, (origin?.top ?? 42) + 12)
    }
    const timer = window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(timer)
  }, [searchOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!hasFile) return
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"], .ant-modal, .ant-drawer')) return
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault()
        setSearchOpen(false)
        return
      }
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        openWorkbookSearch()
        return
      }
      if (target?.closest('input, textarea')) return
      if (key === 'c' && selection) {
        event.preventDefault()
        void copySelectionRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasFile, searchOpen, selection])

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

  useEffect(() => {
    const api = univerAPIRef.current
    if (!api || !activeWorkbookId || loadedWorkbookId !== activeWorkbookId) return
    const cached = workbookCacheRef.current.get(activeWorkbookId)
    const workbook = cached ? api.getWorkbook(cached.unitId) : null
    if (workbook && cached) applyDisplayModes(workbook, cached.sheetDisplaySettings, activeWorkbookId)
  }, [activeWorkbookId, loadedWorkbookId, outlineRevision, showOutlines, showFrozenPanes])

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
            touchCachedWorkbook(cached)
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

        const { workbookData, fonts, sheetTabColors, sheetDisplaySettings } = await withTimeout(convertXlsxToWorkbookData(arrayBuffer, fileName), t('workbook.convertTimedOut'))

        if (loadVersion !== loadVersionRef.current) return

        const previous = workbookCacheRef.current.get(sourceWorkbookId)
        if (previous) api.disposeUnit(previous.unitId)
        outlineCollapsedRef.current.delete(sourceWorkbookId)

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
          sheetDisplaySettings,
          lastUsed: ++cacheAccessCounterRef.current,
        })
        releaseExcessCachedWorkbooks(sourceWorkbookId)
        applyDisplayModes(newWorkbook, sheetDisplaySettings, sourceWorkbookId)
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
      outlineCollapsedRef.current.delete(workbookId)
    }
  }, [openWorkbookIds])

  useEffect(() => {
    if (closeSignal === 0) return
    const api = univerAPIRef.current
    if (!api) return
    for (const cached of workbookCacheRef.current.values()) api.disposeUnit(cached.unitId)
    workbookCacheRef.current.clear()
    outlineCollapsedRef.current.clear()
    setHasFile(false)
    setSelection(null)
    setSearchOpen(false)
    setSearchMatches([])
    setSearchIndex(-1)
    setSearchRan(false)
    searchPlacedRef.current = false
    setSheetNames([])
    onLoadedWorkbookChange(null)
    setError(null)
  }, [closeSignal, setSheetNames])

  const activeOutlineSheetName = (() => {
    if (!activeWorkbookId || activeWorkbookId !== loadedWorkbookId) return null
    const cached = workbookCacheRef.current.get(activeWorkbookId)
    return activeSheet ?? cached?.sheetNames[0] ?? null
  })()

  const activeOutlineGroups = activeWorkbookId && activeOutlineSheetName
    ? workbookCacheRef.current.get(activeWorkbookId)?.sheetDisplaySettings[activeOutlineSheetName]?.outlineGroups ?? []
    : []

  const toggleOutlineGroup = (group: SheetOutlineGroup) => {
    if (!activeWorkbookId || !activeOutlineSheetName) return
    const current = outlineStateFor(activeWorkbookId, activeOutlineSheetName, group)
    outlineCollapsedRef.current.get(activeWorkbookId)?.set(`${activeOutlineSheetName}:${group.id}`, !current)
    setOutlineRevision(version => version + 1)
  }

  const outlineGroupsContent = activeOutlineGroups.length > 0 && activeWorkbookId && activeOutlineSheetName ? (
    <div className="workbook-outline-groups" aria-label={t('workbook.outlineGroups')}>
      {activeOutlineGroups.map(group => {
        const collapsed = outlineStateFor(activeWorkbookId, activeOutlineSheetName, group)
        const rangeLabel = group.axis === 'row'
          ? t('workbook.outlineRows', { start: group.start + 1, end: group.end + 1 })
          : t('workbook.outlineColumns', { start: colToA1(group.start), end: colToA1(group.end) })
        return <Button key={group.id} className="workbook-outline-group" size="small" type="text"
          icon={collapsed ? <PlusSquareOutlined /> : <MinusSquareOutlined />}
          onClick={() => toggleOutlineGroup(group)}>
          <span className="workbook-outline-level">{group.level}</span>{rangeLabel}
        </Button>
      })}
    </div>
  ) : <div className="workbook-outline-groups-empty">{t('workbook.noOutlineGroups')}</div>

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {hasFile && toolbarContainer && createPortal(
        <div className="workbook-readonly-tools" aria-label={t('workbook.readonlyTools')}>
          <Tooltip title={t('workbook.copySelection')}>
            <Button aria-label={t('workbook.copySelection')} aria-keyshortcuts="Control+C Meta+C" type="text" size="small" icon={<CopyOutlined />} disabled={!selection} onClick={() => void copySelection()} />
          </Tooltip>
          <Tooltip title={t('workbook.search')}>
            <Button aria-label={t('workbook.search')} aria-keyshortcuts="Control+F Meta+F" type="text" size="small" icon={<SearchOutlined />} onClick={() => setSearchOpen(current => !current)} />
          </Tooltip>
          <Tooltip title={t('workbook.showOutlines')}>
            <Button aria-label={t('workbook.showOutlines')} aria-pressed={showOutlines} type="text" size="small" className={showOutlines ? 'is-active' : ''} icon={<CompressOutlined />} onClick={() => onDisplaySettingsChange({ ...displaySettings, showOutlines: !showOutlines })} />
          </Tooltip>
          <Popover content={outlineGroupsContent} trigger="click" placement="bottomRight">
            <Tooltip title={t('workbook.outlineGroups')}>
              <Button aria-label={t('workbook.outlineGroups')} type="text" size="small" icon={<UnorderedListOutlined />} disabled={!showOutlines || activeOutlineGroups.length === 0} />
            </Tooltip>
          </Popover>
          <Tooltip title={t('workbook.showFrozenPanes')}>
            <Button aria-label={t('workbook.showFrozenPanes')} aria-pressed={showFrozenPanes} type="text" size="small" className={showFrozenPanes ? 'is-active' : ''} icon={<PushpinOutlined />} onClick={() => onDisplaySettingsChange({ ...displaySettings, showFrozenPanes: !showFrozenPanes })} />
          </Tooltip>
        </div>, toolbarContainer,
      )}
      {hasFile && searchOpen && createPortal(
        <div ref={searchPanelRef} className="workbook-search" role="search" style={{ left: searchPositionRef.current.left, top: searchPositionRef.current.top }}>
          <div className="workbook-search-drag-handle" onPointerDown={beginSearchDrag} onPointerMove={moveSearchPanel} onPointerUp={endSearchDrag} onPointerCancel={endSearchDrag}>
            <span>{t('workbook.search')}</span>
            <Tooltip title={t('common.close')}>
              <Button aria-label={t('common.close')} type="text" size="small" icon={<CloseOutlined />} onPointerDown={event => event.stopPropagation()} onClick={() => setSearchOpen(false)} />
            </Tooltip>
          </div>
          <div className="workbook-search-query">
            <Input ref={searchInputRef} size="small" value={searchQuery} placeholder={t('workbook.searchPlaceholder')}
              onChange={event => setSearchQuery(event.target.value)} onPressEnter={runOrAdvanceSearch}
              suffix={<Button aria-label={t('workbook.search')} type="text" size="small" icon={<SearchOutlined />} onMouseDown={event => event.preventDefault()} onClick={runOrAdvanceSearch} />} />
            <span className="workbook-search-count">{searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : searchRan ? t('workbook.searchNoResults') : ''}</span>
            <Button aria-label={t('workbook.searchPrevious')} type="text" size="small" icon={<LeftOutlined />} disabled={!searchMatches.length}
              onClick={() => focusSearchMatch(searchMatches, (searchIndex - 1 + searchMatches.length) % searchMatches.length)} />
            <Button aria-label={t('workbook.searchNext')} type="text" size="small" icon={<RightOutlined />} disabled={!searchMatches.length}
              onClick={() => focusSearchMatch(searchMatches, (searchIndex + 1) % searchMatches.length)} />
          </div>
          <div className="workbook-search-options">
            <Checkbox checked={searchCaseSensitive} onChange={event => setSearchCaseSensitive(event.target.checked)}>{t('workbook.searchCaseSensitive')}</Checkbox>
            <Checkbox checked={searchWholeCell} onChange={event => setSearchWholeCell(event.target.checked)}>{t('workbook.searchWholeCell')}</Checkbox>
            <Checkbox checked={searchAllSheets} onChange={event => setSearchAllSheets(event.target.checked)}>{t('workbook.searchAllSheets')}</Checkbox>
          </div>
          <div className="workbook-search-results" aria-label={t('workbook.searchResults')}>
            {searchMatches.map((match, index) => <button key={`${match.sheetName}:${match.range.a1Notation}`} className={`workbook-search-result ${index === searchIndex ? 'is-active' : ''}`} type="button" onClick={() => focusSearchMatch(searchMatches, index)}>
              <span>{match.sheetName}!{match.range.a1Notation}</span><span>{match.value || ' '}</span>
            </button>)}
          </div>
        </div>, document.body,
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

function clampFloatingPanelPosition(
  position: { left: number; top: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(0, position.left), Math.max(0, viewport.width - panel.width)),
    top: Math.min(Math.max(0, position.top), Math.max(0, viewport.height - panel.height)),
  }
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

function applyOutlineGroups(
  sheet: any,
  settings: SheetDisplaySettings,
  showOutlines: boolean,
  workbookId: string,
  sheetName: string,
  stateFor: (workbookId: string, sheetName: string, group: SheetOutlineGroup) => boolean,
) {
  for (const axis of ['row', 'column'] as const) {
    const groups = settings.outlineGroups.filter(group => group.axis === axis)
    if (groups.length === 0) {
      const legacyIndexes = axis === 'row' ? settings.outlinedHiddenRows : settings.outlinedHiddenColumns
      for (const [start, count] of contiguousRanges(legacyIndexes)) {
        if (showOutlines) axis === 'row' ? sheet.hideRows(start, count) : sheet.hideColumns(start, count)
        else axis === 'row' ? sheet.showRows(start, count) : sheet.showColumns(start, count)
      }
      continue
    }

    const covered = new Set<number>()
    const hidden = new Set<number>()
    for (const group of groups) {
      const collapsed = showOutlines && stateFor(workbookId, sheetName, group)
      for (let index = group.start; index <= group.end; index += 1) {
        covered.add(index)
        if (collapsed) hidden.add(index)
      }
    }
    for (const [start, count] of contiguousRanges([...covered])) {
      if (axis === 'row') sheet.showRows(start, count)
      else sheet.showColumns(start, count)
    }
    for (const [start, count] of contiguousRanges([...hidden])) {
      if (axis === 'row') sheet.hideRows(start, count)
      else sheet.hideColumns(start, count)
    }
  }
}

function contiguousRanges(indexes: number[]): Array<[start: number, count: number]> {
  const ranges: Array<[number, number]> = []
  for (const index of [...new Set(indexes)].sort((a, b) => a - b)) {
    const previous = ranges.at(-1)
    if (previous && previous[0] + previous[1] === index) previous[1] += 1
    else ranges.push([index, 1])
  }
  return ranges
}
