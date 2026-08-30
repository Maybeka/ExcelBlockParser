import { useRef } from 'react'
import { Button, Input, Tag, Tooltip } from 'antd'
import { AimOutlined, CaretDownOutlined, CaretRightOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, InfoCircleOutlined } from '@ant-design/icons'
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
import { useI18n } from '../../i18n'

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
  infoVisible: boolean
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
  onToggleInfo: () => void
  onStartAddingTag: () => void
  onNewTagInputChange: (value: string) => void
  onCancelAddingTag: () => void
  onStartReconciliation: (report: ReconciliationReport, contentHeight: number) => void
  onEndReconciliation: () => void
  onReconcilingChange?: (blockId: string | null) => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  onPreviewSheet?: (sheetName: string | null) => void
  onFocusRange: () => void
  setContainerRef: (element: HTMLDivElement | null) => void
  setInputRef: (element: { focus: () => void; select: () => void } | null) => void
}

export function BlockInspector(props: BlockInspectorProps) {
  const { t } = useI18n()
  const {
    block, blockIndex, active, activeColIndex, controlsLocked, otherBlockReconciling, reconciling,
    reconciliationReport, reconciliationHeight, duplicateLabel, rowFilterExpanded, computedPropertiesExpanded,
    infoVisible, addingTag, newTagInput, spreadsheet, columnController, onActivate, onChange, onDelete,
    onColumnFocus, onToggleRowFilter, onToggleComputedProperties, onToggleInfo, onStartAddingTag,
    onNewTagInputChange, onCancelAddingTag, onStartReconciliation, onEndReconciliation,
    onReconcilingChange, onReselectRange, onPreviewSheet, onFocusRange, setContainerRef, setInputRef,
  } = props

  const normalContentRef = useRef<HTMLDivElement | null>(null)
  const effectivelyCollapsed = otherBlockReconciling
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
      className={`extractor-card ${effectivelyCollapsed ? 'is-collapsed' : ''}`}
      ref={setContainerRef}
      onMouseDown={() => { if (!otherBlockReconciling) onActivate() }}
    >
      <div className="extractor-card-header">
        <div className="extractor-card-title">
          <Input
            size="small"
            ref={setInputRef}
            value={block.label}
            onChange={event => onChange({ label: event.target.value })}
            placeholder={headerLabel}
            className="card-title-input"
            variant="borderless"
            disabled={controlsLocked || otherBlockReconciling}
            status={(block.label && !isValidVariableName(block.label)) || duplicateLabel ? 'error' : undefined}
          />
        </div>
        <div className="extractor-card-actions">
          {!block.selectionLocked && block.range && !otherBlockReconciling && (
          <Tooltip title={t('block.confirm')}><Button className="card-confirm-button" aria-label={t('block.confirm')} size="small" type="text" icon={<CheckOutlined />} onClick={() => onChange({ selectionLocked: true })} onMouseDown={event => event.stopPropagation()} /></Tooltip>
          )}
          {block.selectionLocked && (
          <Tooltip title={reconciling ? t('common.cancel') : t('block.edit')}>
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
              className={reconciling ? 'is-active' : ''}
            />
          </Tooltip>
          )}
          {block.range && !otherBlockReconciling && <Tooltip title={t('common.focusRange')}><Button aria-label={t('common.focusRange')} size="small" type="text" icon={<AimOutlined />} onClick={event => { event.stopPropagation(); onFocusRange() }} onMouseDown={event => event.stopPropagation()} /></Tooltip>}
          <Tooltip title={infoVisible ? t('common.hideInfo') : t('common.showInfo')}>
          <Button
            aria-label={infoVisible ? 'Hide block info' : 'Show block info'} size="small" type="text" icon={<InfoCircleOutlined />}
            onClick={event => { event.stopPropagation(); onToggleInfo() }} onMouseDown={event => event.stopPropagation()}
            className={infoVisible ? 'is-active' : ''} />
          </Tooltip>
          <Button aria-label={t('block.delete')} size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(headerLabel)} onMouseDown={event => event.stopPropagation()} disabled={controlsLocked} />
        </div>
      </div>

      {!effectivelyCollapsed && infoVisible && (
        <div className="extractor-card-info">
          <div className="extractor-card-info-row"><span>{t('common.tags')}</span><div className="extractor-card-info-value">
          {(block.tags || []).map((tag, index) => (
            <span key={index} className="card-info-tag">
              {index > 0 && <span className="card-info-tag-separator">/</span>}
              <Tag closable onClose={() => onChange({ tags: removeTag({ ...block, tags: block.tags }, tag.key).tags || [] })} className="card-info-tag-value">
                {tag.type === 'kv' ? `${tag.key}:${tag.value || ''}` : tag.key}
              </Tag>
            </span>
          ))}
          {!!block.tags?.length && <span className="card-info-tag-separator">/</span>}
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={onStartAddingTag} className="card-add-tag">{t('block.addTag')}</Button>
          {addingTag && (
            <div className="card-add-tag-editor">
              <Input size="small" value={newTagInput} onChange={event => onNewTagInputChange(event.target.value)} placeholder={t('tag.placeholder')} onPressEnter={submitTag} className="card-add-tag-input" />
              <Button size="small" type="link" onClick={submitTag}>✓</Button>
              <Button size="small" type="text" onClick={onCancelAddingTag}>✗</Button>
            </div>
          )}
          {!block.tags?.length && !addingTag && <span className="extractor-card-info-empty">{t('common.noTags')}</span>}
          </div></div>
          <div className="extractor-card-info-row"><span>{t('common.range')}</span><div className="extractor-card-info-value">
            {block.range ? <span className="extractor-card-range">{block.activeSheet ? `${block.activeSheet}!` : ''}{block.range.a1Notation}</span> : <span className="extractor-card-info-empty">{t('common.noRange')}</span>}
          </div></div>
          <div className="extractor-card-info-row"><span>{t('common.size')}</span><div className="extractor-card-info-value">{block.range ? <>{block.range.endRow - block.range.startRow + 1} {t('common.rows')} × {block.range.endCol - block.range.startCol + 1} {t('common.cols')}{!!block.headerRows.length && <> <span className="extractor-card-info-arrow">→</span> {Math.max(0, block.range.endRow - block.range.startRow + 1 - block.headerRows.length)} {t('block.dataRows')} × {block.range.endCol - block.range.startCol + 1} {t('common.cols')}</>}</> : '—'}</div></div>
        </div>
      )}

      {block.label && !isValidVariableName(block.label) && <div className="card-validation-error">{t('block.invalidName')}</div>}
      {block.label?.trim() && duplicateLabel && <div className="card-validation-error">{t('block.duplicateName')}</div>}

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
        <div className={`extractor-card-body ${controlsLocked ? 'is-locked' : ''}`} ref={normalContentRef}>
          {!block.range ? <div className="card-range-empty">{t('block.selectRange')}</div> : (
            <>
              <HeaderRowsEditor block={block} onChange={headerRows => onChange({ headerRows })} />
              <ColumnEditor
                block={block} active={active} activeColIndex={activeColIndex} controlsLocked={controlsLocked}
                duplicateKeys={duplicateKeys} spreadsheet={spreadsheet} onColumnFocus={onColumnFocus} controller={columnController}
              />
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#999', cursor: 'pointer', userSelect: 'none' }} onClick={onToggleRowFilter}>
                    {rowFilterExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                    {' '}{t('filter.title')} {countRowFilterRules(block.rowFilter?.condition) ? `(${countRowFilterRules(block.rowFilter?.condition)})` : ''}
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
