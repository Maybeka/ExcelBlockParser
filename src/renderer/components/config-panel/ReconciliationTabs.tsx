import { Fragment, useEffect, useState } from 'react'
import { AutoComplete, Button, Checkbox, Select, Typography } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import type { BlockConfig, CellRange, ReconciliationReport } from '../../types'
import { remapColumns } from '../../services/columnMapper'
import { applyRowAdjustFix } from '../../services/reconciliation'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'
import { isValidVariableName } from '../../features/extraction/validation'
import { useI18n } from '../../i18n'

export interface ReconciliationTabsProps {
  report: ReconciliationReport
  block: BlockConfig
  onApply: (block: BlockConfig) => void
  onClose: () => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  spreadsheet: SpreadsheetCapability
  onPreviewSheet?: (sheetName: string | null) => void
  onColumnFocus?: (colIndex: number | null) => void
}

const TYPE_OPTIONS = ['auto', 'string', 'integer', 'float', 'boolean', 'date'].map(value => ({ value, label: value }))

const renderOption = (option: { label?: unknown; value?: unknown }) => {
  const label = typeof option.label === 'string' ? option.label : String(option.value ?? '')
  return <span title={label}>{option.label as React.ReactNode}</span>
}

function columnLetter(index: number): string {
  let letter = ''
  let current = index
  while (current >= 0) {
    letter = String.fromCharCode((current % 26) + 65) + letter
    current = Math.floor(current / 26) - 1
  }
  return letter
}

export function ReconciliationTabs({
  report,
  block,
  onApply,
  onClose,
  onReselectRange,
  spreadsheet,
  onPreviewSheet,
  onColumnFocus,
}: ReconciliationTabsProps) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const [columns, setColumns] = useState(block.columns)
  const [selectedSheet, setSelectedSheet] = useState(block.activeSheet || '')
  const [selectedRange, setSelectedRange] = useState(block.range)
  const [hoveredColIndex, setHoveredColIndex] = useState<number | null>(null)

  useEffect(() => {
    const range = selectedRange || block.range
    if (!range) return
    const columnCount = range.endCol - range.startCol + 1
    setColumns(remapColumns(block.columns, [], columnCount)
      .filter(column => column.colIndex < columnCount)
      .map(column => ({
        ...column,
        colIndex: column.colIndex + range.startCol,
        colLetter: columnLetter(column.colIndex + range.startCol),
      })))
  }, [block.columns, block.range, selectedRange])

  const existingKeys = block.columns.filter(column => !column.skip).map(column => ({ value: column.key }))
  const steps = [t('reconcile.sheet'), t('reconcile.range'), t('reconcile.columns')]
  const circled = ['①', '②', '③']

  const cancel = () => {
    if (block.activeSheet) spreadsheet.setActiveSheet(block.activeSheet)
    onClose()
  }

  const duplicateKeys = new Set<string>()
  const keyCounts = new Map<string, number>()
  columns.filter(column => !column.skip).forEach(column => {
    const key = column.key || column.suggestedKey
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
  })
  keyCounts.forEach((count, key) => { if (count > 1) duplicateKeys.add(key) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
        {steps.map((title, index) => (
          <Fragment key={title}>
            {index > 0 && <span style={{ color: '#d9d9d9', fontSize: 11, margin: '0 2px' }}>→</span>}
            <span
              style={{
                fontSize: 12,
                fontWeight: index === step ? 600 : 400,
                color: index === step ? '#1677ff' : index < step ? '#52c41a' : '#999',
                cursor: index < step ? 'pointer' : 'default',
              }}
              onClick={index < step ? () => setStep(index) : undefined}
            >
              {index < step ? '✓ ' : ''}{circled[index]} {title}
            </span>
          </Fragment>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 4 }}>
        {step === 0 && (
          <div style={{ padding: '8px 12px' }}>
            <Typography.Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
              {t('reconcile.chooseSheet')}
            </Typography.Text>
            <Select
              size="small"
              style={{ width: '100%' }}
              value={selectedSheet || undefined}
              placeholder={t('reconcile.autoSheet')}
              onChange={sheetName => {
                setSelectedSheet(sheetName || '')
                onPreviewSheet?.(sheetName || null)
                spreadsheet.setActiveSheet(sheetName)
              }}
              options={spreadsheet.sheetNames().map(sheetName => ({ value: sheetName, label: sheetName }))}
              allowClear
              optionRender={renderOption}
            />
          </div>
        )}

        {step === 1 && (
          <div style={{ padding: '8px 12px' }}>
            <Typography.Text style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
              {t('reconcile.currentRange')} <span style={{ fontFamily: 'var(--font-code)', color: '#1677ff' }}>
                {selectedRange?.a1Notation || block.range?.a1Notation}
              </span>
            </Typography.Text>
            <Typography.Text style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 8 }}>
              {report.issues.filter(issue => ['row-shifted', 'content-changed'].includes(issue.type)).map(issue => issue.message).join('; ') || t('reconcile.noRangeIssues')}
            </Typography.Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(() => {
                const fix = report.suggestedFixes.find(candidate => candidate.type === 'row-adjust')
                const range = selectedRange || block.range
                if (!fix || !range) return null
                return (
                  <Button size="small" icon={<CheckOutlined />} onClick={() => {
                    const adjusted = applyRowAdjustFix(range, fix)
                    if (adjusted) setSelectedRange(adjusted)
                  }}>
                    {t('reconcile.applyShift')}
                  </Button>
                )
              })()}
              <Button size="small" onClick={() => onReselectRange?.(setSelectedRange)}>{t('reconcile.reselect')}</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ padding: '8px 12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 36px', gap: '4px 6px', alignItems: 'center', padding: '2px 0', fontSize: 11, color: '#999' }}>
              <span>{t('column.column')}</span><span>{t('column.key')}</span><span>{t('column.type')}</span><span>{t('column.skip')}</span>
            </div>
            {columns.map(column => (
              <div
                key={column.colIndex}
                style={{
                  display: 'grid', gridTemplateColumns: '28px 1fr 90px 36px', gap: '4px 6px', alignItems: 'center', marginBottom: 4,
                  background: hoveredColIndex === column.colIndex ? 'rgba(250, 140, 22, 0.06)' : 'transparent', borderRadius: 4, padding: '2px 6px',
                }}
                onMouseEnter={() => { setHoveredColIndex(column.colIndex); onColumnFocus?.(column.colIndex) }}
                onMouseLeave={() => { setHoveredColIndex(null); onColumnFocus?.(null) }}
              >
                <span style={{ fontSize: 12, fontFamily: 'var(--font-code)', fontWeight: 600, color: '#666', cursor: 'pointer' }} onClick={() => {
                  const range = selectedRange || block.range
                  if (!range) return
                  const activeSheet = selectedSheet || block.activeSheet
                  if (activeSheet) spreadsheet.setActiveSheet(activeSheet)
                  spreadsheet.scrollTo(activeSheet, range.startRow - 1, column.colIndex - 3)
                }}>{column.colLetter}</span>
                <AutoComplete
                  size="small"
                  value={column.key}
                  onChange={key => setColumns(current => current.map(item => item.colIndex === column.colIndex ? { ...item, key } : item))}
                  options={existingKeys}
                  style={{ fontSize: 13 }}
                  status={duplicateKeys.has(column.key || column.suggestedKey) || (column.key && !isValidVariableName(column.key)) ? 'error' : undefined}
                />
                {duplicateKeys.has(column.key || column.suggestedKey) && <div style={{ gridColumn: '2', fontSize: 10, color: '#ff4d4f' }}>{t('column.duplicate')}</div>}
                {column.key && !isValidVariableName(column.key) && <div style={{ gridColumn: '2', fontSize: 10, color: '#ff4d4f' }}>{t('block.invalidName')}</div>}
                <Select
                  size="small"
                  value={column.type}
                  onChange={type => setColumns(current => current.map(item => item.colIndex === column.colIndex ? { ...item, type } : item))}
                  options={TYPE_OPTIONS}
                  style={{ width: 90 }}
                  optionRender={renderOption}
                />
                <Checkbox checked={column.skip} onChange={event => setColumns(current => current.map(item => item.colIndex === column.colIndex ? { ...item, skip: event.target.checked } : item))} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid #f0f0f0' }}>
        {step > 0 && <Button size="small" onClick={() => setStep(step - 1)}>{t('reconcile.previous')} {steps[step - 1]}</Button>}
        {step < 2 && <Button type="primary" size="small" onClick={() => setStep(step + 1)}>{t('reconcile.next')} {steps[step + 1]}</Button>}
        <Button type="primary" size="small" onClick={() => onApply({
          ...block,
          columns,
          activeSheet: selectedSheet || block.activeSheet,
          range: selectedRange || block.range,
        })}>{t('reconcile.applyClose')}</Button>
        <Button size="small" onClick={cancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  )
}
