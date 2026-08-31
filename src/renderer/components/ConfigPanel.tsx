import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Divider, Input, Modal, Select, Switch, Tooltip } from 'antd'
import { CompressOutlined, ExpandOutlined, PlusOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons'
import type { BlockConfig, CellRange, ParseResult, WorkbookConfig } from '../types'
import type { SpreadsheetCapability } from '../services/spreadsheetCapability'
import { filterBlocksByTag, getAllTags } from '../services/tagUtils'
import { BlockInspector } from './config-panel/BlockInspector'
import { useColumnConfiguration } from './config-panel/useColumnConfiguration'
import { useI18n } from '../i18n'
import { resetBlockRange, type BlockRangeReset } from '../features/extraction/rangeReset'

export type FocusMode = 'always-editable' | 'activate-first'

export interface ConfigPanelProps {
  spreadsheet: SpreadsheetCapability
  workbooks: WorkbookConfig[]
  loadedWorkbookId: string | null
  blocks: BlockConfig[]
  activeBlockId: string
  activeColIndex: number | null
  focusMode: FocusMode
  parseResult: ParseResult | null
  onActivateBlock: (blockId: string) => void
  onBlockChange: (blockId: string, partial: Partial<BlockConfig>) => void
  onAddBlock: () => void
  onDeleteBlock: (blockId: string) => void
  onFocusModeChange: (mode: FocusMode) => void
  onColumnFocus: (colIndex: number | null) => void
  onReconcilingChange?: (blockId: string | null) => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  onPreviewSheet?: (sheetName: string | null) => void
  onFocusRange: (blockId: string) => void
  onFocusRangeReset: (source: BlockRangeSource) => void
  onActivateWorkbook: (workbookId: string, sheetName?: string) => void
  canAddBlock?: boolean
  toolbarTarget?: HTMLElement | null
}

type SearchTarget = 'all' | 'title' | 'columnName' | 'tag'

const renderOption = (option: { label?: unknown; value?: unknown }) => {
  const label = typeof option.label === 'string' ? option.label : String(option.value ?? '')
  return <span title={label}>{option.label as React.ReactNode}</span>
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current)
  next.has(value) ? next.delete(value) : next.add(value)
  return next
}

export function ConfigPanel({
  spreadsheet,
  workbooks,
  loadedWorkbookId,
  blocks,
  activeBlockId,
  activeColIndex,
  focusMode,
  onActivateBlock,
  onBlockChange,
  onAddBlock,
  onDeleteBlock,
  onFocusModeChange,
  onColumnFocus,
  onReconcilingChange,
  onReselectRange,
  onPreviewSheet,
  onFocusRange,
  onFocusRangeReset,
  onActivateWorkbook,
  canAddBlock = true,
  toolbarTarget,
}: ConfigPanelProps) {
  const { t } = useI18n()
  const [showSettings, setShowSettings] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchTarget, setSearchTarget] = useState<SearchTarget>('all')
  const [tagFilter, setTagFilter] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)
  const [reconcilingBlockId, setReconcilingBlockId] = useState<string | null>(null)
  const [expandedRowFilters, setExpandedRowFilters] = useState<Set<string>>(new Set())
  const [expandedComputedProperties, setExpandedComputedProperties] = useState<Set<string>>(new Set())
  const [visibleTags, setVisibleTags] = useState<Set<string>>(new Set())
  const [addingTagForBlock, setAddingTagForBlock] = useState<string | null>(null)
  const [newTagInput, setNewTagInput] = useState('')
  const blockContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const blockInputRefs = useRef<Record<string, { focus: () => void; select: () => void } | null>>({})
  const shouldAutoFocus = useRef(false)
  const previousBlockCount = useRef(blocks.length)
  const columnController = useColumnConfiguration(blocks, spreadsheet, onBlockChange)

  const allTags = useMemo(() => getAllTags(blocks), [blocks])
  const filteredBlocks = useMemo(() => {
    let result = blocks
    if (searchText.trim()) {
      const query = searchText.toLowerCase().trim()
      result = result.filter(block => {
        const label = (block.label || '').toLowerCase()
        const columns = block.columns || []
        if (searchTarget === 'title') return label.includes(query)
        if (searchTarget === 'columnName') return columns.some(column => (column.key || column.suggestedKey || '').toLowerCase().includes(query))
        if (searchTarget === 'tag') return (block.tags || []).some(tag => tag.key.toLowerCase().includes(query) || (tag.value || '').toLowerCase().includes(query))
        return label.includes(query) || columns.some(column => (column.key || column.suggestedKey || '').toLowerCase().includes(query))
      })
    }
    return tagFilter ? filterBlocksByTag(result, tagFilter) : result
  }, [blocks, searchTarget, searchText, tagFilter])

  const duplicateLabels = useMemo(() => {
    const counts = new Map<string, number>()
    blocks.forEach(block => {
      const label = (block.label || '').trim()
      if (label) counts.set(label, (counts.get(label) || 0) + 1)
    })
    return new Set([...counts].filter(([, count]) => count > 1).map(([label]) => label))
  }, [blocks])

  const handleAdd = useCallback(() => {
    shouldAutoFocus.current = true
    onAddBlock()
  }, [onAddBlock])

  useEffect(() => {
    if (shouldAutoFocus.current && blocks.length > previousBlockCount.current) {
      shouldAutoFocus.current = false
      const lastBlock = blocks.at(-1)
      if (lastBlock) requestAnimationFrame(() => {
        blockContainerRefs.current[lastBlock.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        blockInputRefs.current[lastBlock.id]?.focus()
        blockInputRefs.current[lastBlock.id]?.select()
      })
    }
    previousBlockCount.current = blocks.length
  }, [blocks])

  const cancelTagEntry = () => {
    setAddingTagForBlock(null)
    setNewTagInput('')
  }

  const headerToolbar = (
    <>
      {searchText && <span className="config-panel-filter-count">{filteredBlocks.length}/{blocks.length}</span>}
      <Tooltip title={t('config.collapseAll')}>
        <Button aria-label={t('config.collapseAll')} size="small" type="text" icon={<CompressOutlined />} onClick={() => blocks.forEach(block => { if (!block.collapsed) onBlockChange(block.id, { collapsed: true }) })} />
      </Tooltip>
      <Tooltip title={t('config.expandAll')}>
        <Button aria-label={t('config.expandAll')} size="small" type="text" icon={<ExpandOutlined />} onClick={() => blocks.forEach(block => { if (block.collapsed) onBlockChange(block.id, { collapsed: false }) })} />
      </Tooltip>
      <Divider type="vertical" style={{ margin: '0 4px' }} />
      <Tooltip title={showSearch ? t('config.hideSearch') : t('config.search')}>
        <Button aria-label={showSearch ? t('config.hideSearch') : t('config.search')} size="small" type="text" icon={<SearchOutlined />} onClick={() => {
          setShowSearch(current => {
            if (current) setSearchText('')
            return !current
          })
        }} style={{ color: showSearch ? 'var(--fluent-accent)' : undefined }} />
      </Tooltip>
      <Tooltip title={t('config.settings')}>
        <Button aria-label={t('config.settings')} size="small" type="text" icon={<SettingOutlined />} onClick={() => setShowSettings(current => !current)} style={{ color: showSettings ? 'var(--fluent-accent)' : undefined }} />
      </Tooltip>
    </>
  )

  if (!blocks.length) {
    return <div style={{ padding: 16 }}><Button block icon={<PlusOutlined />} disabled={!canAddBlock} onClick={handleAdd}>{t('config.addBlock')}</Button></div>
  }

  return (
    <div className="config-panel" style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {toolbarTarget && createPortal(<div className="config-panel-header-toolbar">{headerToolbar}</div>, toolbarTarget)}
      <div className="config-panel-content-controls">
        {showSettings && (
          <div style={{ marginBottom: 12, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{t('config.lockInactive')}</span>
            <Switch size="small" checked={focusMode === 'activate-first'} onChange={checked => onFocusModeChange(checked ? 'activate-first' : 'always-editable')} />
          </div>
        )}
        {showSettings && showSearch && <Divider style={{ margin: '0 0 8px' }} />}
        {showSearch && (
          <>
            <div style={{ marginBottom: 12, display: 'flex', gap: 6 }}>
              <Select
                size="small" value={searchTarget} onChange={setSearchTarget} style={{ width: 96, flexShrink: 0 }}
                options={[{ value: 'all', label: t('config.searchAll') }, { value: 'title', label: t('config.searchTitle') }, { value: 'columnName', label: t('config.searchKey') }, { value: 'tag', label: t('config.searchTag') }]}
                optionRender={renderOption}
              />
              <Input size="small" placeholder={t('config.searchPlaceholder')} prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />} value={searchText} onChange={event => setSearchText(event.target.value)} allowClear style={{ flex: 1 }} />
            </div>
            {!!allTags.length && (
              <div style={{ marginBottom: 12 }}>
                <Select
                  size="small" value={tagFilter} onChange={setTagFilter} allowClear placeholder={t('config.filterTag')} style={{ width: '100%' }}
                  options={allTags.map(tag => ({ value: tag.key, label: tag.type === 'kv' ? `${tag.key}:${tag.value || ''}` : tag.key }))}
                />
              </div>
            )}
          </>
        )}
        {(showSearch || showSettings) && <Divider style={{ margin: '0 0 8px' }} />}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredBlocks.map(block => {
          const active = block.id === activeBlockId
          const controlsLocked = focusMode === 'activate-first' && !active
          return (
            <BlockInspector
              key={block.id}
              block={block}
              blockIndex={blocks.indexOf(block)}
              active={active}
              activeColIndex={activeColIndex}
              controlsLocked={controlsLocked}
              otherBlockReconciling={reconcilingBlockId !== null && block.id !== reconcilingBlockId}
              reconciling={reconcilingBlockId === block.id}
              duplicateLabel={duplicateLabels.has(block.label?.trim() || '')}
              rowFilterExpanded={expandedRowFilters.has(block.id)}
              computedPropertiesExpanded={expandedComputedProperties.has(block.id)}
              infoVisible={visibleTags.has(block.id)}
              addingTag={addingTagForBlock === block.id}
              newTagInput={newTagInput}
              spreadsheet={spreadsheet}
              workbooks={workbooks}
              loadedWorkbookId={loadedWorkbookId}
              columnController={columnController}
              onActivate={() => onActivateBlock(block.id)}
              onChange={partial => onBlockChange(block.id, partial)}
              onDelete={label => setDeleteTarget({ id: block.id, label })}
              onColumnFocus={onColumnFocus}
              onToggleRowFilter={() => setExpandedRowFilters(current => toggleSetValue(current, block.id))}
              onToggleComputedProperties={() => setExpandedComputedProperties(current => toggleSetValue(current, block.id))}
              onToggleInfo={() => setVisibleTags(current => toggleSetValue(current, block.id))}
              onStartAddingTag={() => setAddingTagForBlock(block.id)}
              onNewTagInputChange={setNewTagInput}
              onCancelAddingTag={cancelTagEntry}
              onStartRangeReset={() => setReconcilingBlockId(block.id)}
              onEndRangeReset={() => setReconcilingBlockId(null)}
              onApplyRangeReset={(source: BlockRangeReset) => { onBlockChange(block.id, resetBlockRange(block, source)); onFocusRangeReset(source) }}
              onActivateWorkbook={onActivateWorkbook}
              onReconcilingChange={onReconcilingChange}
              onReselectRange={onReselectRange}
              onPreviewSheet={onPreviewSheet}
              onFocusRange={() => onFocusRange(block.id)}
              setContainerRef={element => { blockContainerRefs.current[block.id] = element }}
              setInputRef={element => { blockInputRefs.current[block.id] = element }}
            />
          )
        })}

        {searchText && !filteredBlocks.length && <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '16px 0' }}>{t('config.noMatches', { value: searchText })}</div>}
      </div>

      <Modal
        title={t('config.deleteBlock')} open={!!deleteTarget}
        onOk={() => { if (deleteTarget) onDeleteBlock(deleteTarget.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)} okText={t('common.delete')} okType="danger" cancelText={t('common.cancel')}
      >{t('config.deleteConfirm', { label: deleteTarget?.label ?? '' })}</Modal>
    </div>
  )
}
