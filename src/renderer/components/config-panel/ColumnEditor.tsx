import { Checkbox, Input, Select, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { BlockConfig, ColumnType } from '../../types'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'
import { isValidVariableName } from '../../features/extraction/validation'
import type { ColumnConfigurationController } from './useColumnConfiguration'
import { ValueMapEditor } from './ValueMapEditor'

const TYPE_OPTIONS: Array<{ value: ColumnType; label: string }> = [
  { value: 'auto', label: 'auto' },
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'valueMapping', label: 'value mapping' },
]

export interface ColumnEditorProps {
  block: BlockConfig
  active: boolean
  activeColIndex: number | null
  controlsLocked: boolean
  duplicateKeys: Set<string>
  spreadsheet: SpreadsheetCapability
  onColumnFocus: (colIndex: number | null) => void
  controller: ColumnConfigurationController
}

export function ColumnEditor({
  block,
  active,
  activeColIndex,
  controlsLocked,
  duplicateKeys,
  spreadsheet,
  onColumnFocus,
  controller,
}: ColumnEditorProps) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 100px 36px', gap: '4px 6px', alignItems: 'center', padding: '2px 6px', fontSize: 11, color: '#999' }}>
        <span>Col</span>
        <span>
          Key
          <Tooltip title="Regenerate all keys from header rows">
            <ReloadOutlined
              style={{ cursor: controlsLocked || !block.range ? 'not-allowed' : 'pointer', color: controlsLocked || !block.range ? '#d9d9d9' : '#999', fontSize: 11, marginLeft: 4 }}
              onClick={event => {
                event.stopPropagation()
                if (!controlsLocked && block.range) controller.regenerateAllColumnKeys(block.id)
              }}
            />
          </Tooltip>
        </span>
        <span>Type</span>
        <span>Skip</span>
      </div>

      {!block.columns.length && <div style={{ fontSize: 12, color: '#bbb', padding: '4px 6px' }}>No columns in range</div>}

      {block.columns.map(column => (
        <div
          key={column.colIndex}
          style={{ marginBottom: 2 }}
          onMouseEnter={() => { if (active) onColumnFocus(column.colIndex) }}
          onMouseLeave={() => { if (active) onColumnFocus(null) }}
        >
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 100px 36px', gap: '4px 6px', alignItems: 'center', padding: '2px 6px', borderRadius: 4,
            opacity: column.skip || controlsLocked ? 0.35 : 1,
            background: activeColIndex === column.colIndex ? 'rgba(250, 140, 22, 0.06)' : 'transparent',
          }}>
            <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#666', cursor: 'pointer' }} onClick={() => {
              if (!block.range) return
              if (block.activeSheet) spreadsheet.setActiveSheet(block.activeSheet)
              spreadsheet.scrollTo(block.activeSheet, block.range.startRow - 1, column.colIndex - 3)
            }}>{column.colLetter}</span>
            <Input
              size="small"
              value={column.key}
              onChange={event => controller.updateColumn(block.id, column.colIndex, { key: event.target.value })}
              disabled={controlsLocked || column.skip}
              status={duplicateKeys.has(column.key || column.suggestedKey) || (column.key && !isValidVariableName(column.key)) ? 'error' : undefined}
              onFocus={() => { if (active) onColumnFocus(column.colIndex) }}
              onBlur={() => onColumnFocus(null)}
              suffix={<Tooltip title="Regenerate from header rows"><ReloadOutlined
                style={{ cursor: controlsLocked || column.skip || !block.range ? 'not-allowed' : 'pointer', color: controlsLocked || column.skip || !block.range ? '#d9d9d9' : '#999', fontSize: 11 }}
                onClick={event => {
                  event.stopPropagation()
                  if (!controlsLocked && !column.skip && block.range) controller.regenerateColumnKey(block.id, column.colIndex)
                }}
              /></Tooltip>}
              style={{ fontSize: 13 }}
            />
            <Select
              size="small"
              value={column.type}
              onChange={type => controller.updateColumn(block.id, column.colIndex, { type })}
              options={TYPE_OPTIONS}
              disabled={controlsLocked || column.skip}
              style={{ fontSize: 13 }}
              onFocus={() => { if (active) onColumnFocus(column.colIndex) }}
              onBlur={() => onColumnFocus(null)}
            />
            <Checkbox
              checked={column.skip}
              onChange={event => controller.updateColumn(block.id, column.colIndex, { skip: event.target.checked })}
              disabled={controlsLocked}
              onFocus={() => { if (active) onColumnFocus(column.colIndex) }}
              onBlur={() => onColumnFocus(null)}
            />
          </div>

          {duplicateKeys.has(column.key || column.suggestedKey) && <div style={{ fontSize: 10, color: '#ff4d4f', padding: '0 6px 4px' }}>Duplicate key</div>}
          {column.key && !isValidVariableName(column.key) && <div style={{ fontSize: 10, color: '#ff4d4f', padding: '0 6px 4px' }}>Invalid variable name</div>}
          {column.type === 'valueMapping' && <ValueMapEditor block={block} column={column} controlsLocked={controlsLocked} controller={controller} />}
        </div>
      ))}
    </div>
  )
}
