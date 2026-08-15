import { useRef } from 'react'
import { Button, Divider, Input, Tag, Tooltip } from 'antd'
import { CaretDownOutlined, CaretRightOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, TagOutlined } from '@ant-design/icons'
import type { BlockConfig, CellRange, ReconciliationReport, Tag as TagType } from '../../types'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'
import { addTag, removeTag } from '../../services/tagUtils'
import { runReconciliation } from '../../services/reconciliation'
import { isValidVariableName } from '../../features/extraction/validation'
import { countRowFilterRules, RowFilterEditor } from '../RowFilterEditor'
import { HeaderRowsEditor } from './HeaderRowsEditor'
import { ReconciliationTabs } from './ReconciliationTabs'
import { ColumnEditor } from './ColumnEditor'
import { DownstreamPropertiesEditor } from './DownstreamPropertiesEditor'
import type { ColumnConfigurationController } from './useColumnConfiguration'

export interface BlockInspectorProps {
  block: BlockConfig
  blockIndex: number
  active: boolean
  activeColIndex: number | null
  controlsLocked: boolean
  otherBlockReconciling: boolean
  reconciling: boolean
  reconciliationReport?: ReconciliationReport
  reconciliationHeight?: number
  duplicateLabel: boolean
  rowFilterExpanded: boolean
  computedPropertiesExpanded: boolean
  tagsVisible: boolean
  addingTag: boolean
  newTagInput: string
  spreadsheet: SpreadsheetCapability
  columnController: ColumnConfigurationController
  onActivate: () => void
  onChange: (partial: Partial<BlockConfig>) => void
  onDelete: (label: string) => void
  onColumnFocus: (colIndex: number | null) => void
  onToggleRowFilter: () => void
  onToggleComputedProperties: () => void
  onToggleTags: () => void
  onStartAddingTag: () => void
  onNewTagInputChange: (value: string) => void
  onCancelAddingTag: () => void
  onStartReconciliation: (report: ReconciliationReport, contentHeight: number) => void
  onEndReconciliation: () => void
  onReconcilingChange?: (blockId: string | null) => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  onPreviewSheet?: (sheetName: string | null) => void
  setContainerRef: (element: HTMLDivElement | null) => void
  setInputRef: (element: { focus: () => void; select: () => void } | null) => void
}

export function BlockInspector(props: BlockInspectorProps) {
  const {
    block, blockIndex, active, activeColIndex, controlsLocked, otherBlockReconciling, reconciling,
    reconciliationReport, reconciliationHeight, duplicateLabel, rowFilterExpanded, computedPropertiesExpanded,
    tagsVisible, addingTag, newTagInput, spreadsheet, columnController, onActivate, onChange, onDelete,
    onColumnFocus, onToggleRowFilter, onToggleComputedProperties, onToggleTags, onStartAddingTag,
    onNewTagInputChange, onCancelAddingTag, onStartReconciliation, onEndReconciliation,
    onReconcilingChange, onReselectRange, onPreviewSheet, setContainerRef, setInputRef,
  } = props

  const normalContentRef = useRef<HTMLDivElement | null>(null)
  const effectivelyCollapsed = block.collapsed || otherBlockReconciling
  const headerLabel = block.label?.trim() || `block_${blockIndex + 1}`

  const duplicateKeys = new Set<string>()
  const keyCounts = new Map<string, number>()
  block.columns.filter(column => !column.skip).forEach(column => {
    const key = column.key || column.suggestedKey
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
  })
  ;(block.computedProperties || []).forEach(property => {
    const key = property.label?.trim()
    if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
  })
  keyCounts.forEach((count, key) => { if (count > 1) duplicateKeys.add(key) })

  const submitTag = () => {
    if (!newTagInput.trim()) return
    const colonIndex = newTagInput.indexOf(':')
    const tag: TagType = colonIndex > 0
      ? { type: 'kv', key: newTagInput.slice(0, colonIndex).trim(), value: newTagInput.slice(colonIndex + 1).trim() || undefined }
      : { type: 'label', key: newTagInput.trim() }
    onChange({ tags: addTag({ ...block, tags: block.tags }, tag).tags })
    onCancelAddingTag()
  }

  return (
    <div
      className={`extractor-card ${active ? 'is-active' : ''}`}
      ref={setContainerRef}
      onMouseDown={() => { if (!otherBlockReconciling) onActivate() }}
      style={{
        marginBottom: 8,
        border: `1px solid ${active ? '#1677ff' : '#d9d9d9'}`,
        borderRadius: 6,
        borderLeft: active ? '3px solid #1677ff' : '3px solid transparent',
        background: active ? '#f0f5ff' : '#fafafa',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div className="extractor-card-header" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: effectivelyCollapsed ? 'none' : '1px solid #f0f0f0' }}>
        <span
          onClick={() => { if (!otherBlockReconciling) onChange({ collapsed: !block.collapsed }) }}
          style={{ color: otherBlockReconciling ? '#d9d9d9' : '#999', cursor: otherBlockReconciling ? 'default' : 'pointer', fontSize: 12 }}
        >{effectivelyCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}</span>
        <Input
          size="small"
          ref={setInputRef}
          value={block.label}
          onChange={event => onChange({ label: event.target.value })}
          placeholder={headerLabel}
          style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
          variant="borderless"
          disabled={controlsLocked || otherBlockReconciling}
          status={(block.label && !isValidVariableName(block.label)) || duplicateLabel ? 'error' : undefined}
        />
        {block.range && (
          <Tooltip title={`${block.activeSheet || '(active sheet)'}!${block.range.a1Notation} — click to go`}>
            <span
              onClick={event => {
                event.stopPropagation()
                if (otherBlockReconciling) return
                onActivate()
                if (block.activeSheet) spreadsheet.setActiveSheet(block.activeSheet)
                spreadsheet.scrollTo(block.activeSheet, block.range!.startRow - 3, block.range!.startCol - 1)
              }}
              onMouseDown={event => event.stopPropagation()}
              style={{ fontSize: 12, color: '#1677ff', fontFamily: 'var(--font-code)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
            >{block.activeSheet ? `${block.activeSheet}!` : ''}{block.range.a1Notation}</span>
          </Tooltip>
        )}
        {!block.selectionLocked && block.range && !otherBlockReconciling && (
          <Tooltip title="Confirm block"><Button aria-label="Confirm block" size="small" type="text" icon={<CheckOutlined style={{ color: '#52c41a' }} />} onClick={() => onChange({ selectionLocked: true })} onMouseDown={event => event.stopPropagation()} /></Tooltip>
        )}
        {block.selectionLocked && (
          <Tooltip title={reconciling ? 'Discard editing' : 'Edit block'}>
            <Button
              aria-label={reconciling ? 'Discard block editing' : 'Edit block'}
              size="small" type="text" icon={reconciling ? <CloseOutlined /> : <EditOutlined />}
              onClick={async event => {
                event.stopPropagation()
                if (controlsLocked || !block.range) return
                onActivate()
                if (reconciling) {
                  if (block.activeSheet) spreadsheet.setActiveSheet(block.activeSheet)
                  onEndReconciliation()
                  onReconcilingChange?.(null)
                  return
                }
                const workbook = spreadsheet.workbookReader()
                if (!workbook) return
                if (block.activeSheet) spreadsheet.setActiveSheet(block.activeSheet)
                const report = await runReconciliation(block, workbook, spreadsheet.sheetNames())
                onStartReconciliation(report, normalContentRef.current?.offsetHeight || 0)
                onPreviewSheet?.(block.activeSheet || spreadsheet.activeSheetName())
                onReconcilingChange?.(block.id)
              }}
              disabled={controlsLocked || !block.range || otherBlockReconciling}
              style={{ opacity: block.range ? 1 : 0.3, color: reconciling ? '#1677ff' : undefined }}
            />
          </Tooltip>
        )}
        <Divider type="vertical" style={{ margin: '0 2px', borderColor: '#d9d9d9' }} />
        <Tooltip title={tagsVisible ? 'Hide tags' : 'Show tags'}>
          <Button
            aria-label={tagsVisible ? 'Hide block tags' : 'Show block tags'} size="small" type="text" icon={<TagOutlined />}
            onClick={event => { event.stopPropagation(); onToggleTags() }} onMouseDown={event => event.stopPropagation()}
            style={{ color: tagsVisible ? '#1677ff' : undefined }}
          >{block.tags?.length ? <span style={{ fontSize: 11, marginLeft: 4 }}>{block.tags.length}</span> : null}</Button>
        </Tooltip>
        <Divider type="vertical" style={{ margin: '0 2px', borderColor: '#d9d9d9' }} />
        <Button aria-label="Delete block" size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(headerLabel)} onMouseDown={event => event.stopPropagation()} disabled={controlsLocked} />
      </div>

      {!effectivelyCollapsed && tagsVisible && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px 4px 34px', overflow: 'auto' }}>
          {(block.tags || []).map((tag, index) => (
            <span key={index} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, color: '#1677ff', whiteSpace: 'nowrap' }}>
              {index > 0 && <span style={{ color: '#bbb', margin: '0 2px' }}>/</span>}
              <Tag closable onClose={() => onChange({ tags: removeTag({ ...block, tags: block.tags }, tag.key).tags || [] })} style={{ margin: 0, fontSize: 11 }}>
                {tag.type === 'kv' ? `${tag.key}:${tag.value || ''}` : tag.key}
              </Tag>
            </span>
          ))}
          {!!block.tags?.length && <span style={{ color: '#bbb', margin: '0 2px' }}>/</span>}
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={onStartAddingTag} style={{ fontSize: 11, height: 22, padding: '0 6px', flexShrink: 0 }}>Tag</Button>
          {addingTag && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              <Input size="small" value={newTagInput} onChange={event => onNewTagInputChange(event.target.value)} placeholder="tag or key:value" onPressEnter={submitTag} style={{ width: 130, fontSize: 12 }} />
              <Button size="small" type="link" onClick={submitTag}>✓</Button>
              <Button size="small" type="text" onClick={onCancelAddingTag}>✗</Button>
            </div>
          )}
        </div>
      )}

      {block.label && !isValidVariableName(block.label) && <div style={{ padding: '0 10px 6px', fontSize: 10, color: '#ff4d4f' }}>Invalid variable name</div>}
      {block.label?.trim() && duplicateLabel && <div style={{ padding: '0 10px 6px', fontSize: 10, color: '#ff4d4f' }}>Duplicate block name</div>}

      {reconciling && reconciliationReport ? (
        <div style={{ overflow: 'auto', height: reconciliationHeight || 'auto' }}>
          <ReconciliationTabs
            report={reconciliationReport} block={block} onReselectRange={onReselectRange} onPreviewSheet={onPreviewSheet}
            spreadsheet={spreadsheet} onColumnFocus={onColumnFocus}
            onApply={updatedBlock => { onChange(updatedBlock); onEndReconciliation(); onReconcilingChange?.(null) }}
            onClose={() => { onEndReconciliation(); onReconcilingChange?.(null) }}
          />
        </div>
      ) : !effectivelyCollapsed && (
        <div className="extractor-card-body" ref={normalContentRef} style={{ padding: '8px 12px', opacity: controlsLocked ? 0.5 : 1 }}>
          {!block.range ? <div style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>Click and drag in the spreadsheet to select a data range.</div> : (
            <>
              <div style={{ background: '#f5f5f5', padding: '6px 10px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-code)', marginBottom: 8 }}>
                {block.range.endRow - block.range.startRow + 1} rows × {block.range.endCol - block.range.startCol + 1} cols
                {!!block.headerRows.length && <span style={{ fontSize: 12, color: '#999' }}> → {Math.max(0, block.range.endRow - block.range.startRow + 1 - block.headerRows.length)} data rows</span>}
              </div>
              <HeaderRowsEditor block={block} onChange={headerRows => onChange({ headerRows })} />
              <ColumnEditor
                block={block} active={active} activeColIndex={activeColIndex} controlsLocked={controlsLocked}
                duplicateKeys={duplicateKeys} spreadsheet={spreadsheet} onColumnFocus={onColumnFocus} controller={columnController}
              />
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#999', cursor: 'pointer', userSelect: 'none' }} onClick={onToggleRowFilter}>
                    {rowFilterExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                    {' '}Row Filter {countRowFilterRules(block.rowFilter?.condition) ? `(${countRowFilterRules(block.rowFilter?.condition)})` : ''}
                  </span>
                </div>
                {rowFilterExpanded && <RowFilterEditor config={block.rowFilter} columnKeys={block.columns.filter(column => !column.skip).map(column => column.key || column.suggestedKey)} onChange={rowFilter => onChange({ rowFilter })} />}
              </div>
              <DownstreamPropertiesEditor block={block} expanded={computedPropertiesExpanded} duplicateKeys={duplicateKeys} onToggle={onToggleComputedProperties} onChange={onChange} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
