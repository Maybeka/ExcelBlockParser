import { Button, Input, Segmented, Select, Tooltip } from 'antd'
import { CaretDownOutlined, CaretRightOutlined, ClearOutlined, DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { BlockConfig, ColumnMapping, ValueMapFallbackType } from '../../types'
import type { ColumnConfigurationController } from './useColumnConfiguration'

const FALLBACK_TYPE_OPTIONS: Array<{ value: ValueMapFallbackType; label: string }> = [
  { value: 'auto', label: 'auto' },
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
]

export interface ValueMapEditorProps {
  block: BlockConfig
  column: ColumnMapping
  controlsLocked: boolean
  controller: ColumnConfigurationController
}

export function ValueMapEditor({ block, column, controlsLocked, controller }: ValueMapEditorProps) {
  const mapKey = `${block.id}-${column.colIndex}`
  const expanded = controller.expandedMaps.has(mapKey)
  const table = controller.columnTables[mapKey]
  const hasMappings = column.valueMap.length > 0

  return (
    <div style={{ paddingLeft: 34 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          onClick={() => controller.toggleValueMap(mapKey)}
          style={{
            fontSize: 11, color: hasMappings ? '#1677ff' : '#999',
            cursor: controlsLocked ? 'default' : 'pointer', userSelect: 'none',
            pointerEvents: controlsLocked ? 'none' : 'auto',
          }}
        >
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          {' '}Value Map{hasMappings ? ` (${column.valueMap.length})` : ''}
        </span>
        {expanded && (
          <Segmented
            size="small"
            value={table?.active ? 'table' : 'kv'}
            onChange={() => controller.toggleTableView(mapKey, block.id, column.colIndex)}
            options={[{ label: 'KV', value: 'kv' }, { label: 'Table', value: 'table' }]}
            disabled={controlsLocked}
            style={{ fontSize: 11 }}
          />
        )}
      </div>

      {expanded && table?.active && (
        <>
          <div style={{ marginTop: 4, display: 'flex', gap: 4, marginBottom: 4 }}>
            <Input
              size="small"
              placeholder="Search values..."
              prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 11 }} />}
              value={table.search || ''}
              onChange={event => controller.setColumnSearch(mapKey, event.target.value)}
              disabled={controlsLocked}
              allowClear
              style={{ fontSize: 11, flex: 1 }}
            />
            <Tooltip title="Add all unmapped as entries">
              <Button size="small" icon={<PlusOutlined />} onClick={() => controller.addAllUnmapped(block.id, column.colIndex)} disabled={controlsLocked || !table.values?.length} />
            </Tooltip>
            <Tooltip title="Clear all mappings">
              <Button size="small" danger icon={<ClearOutlined />} onClick={() => controller.clearAllMappings(block.id, column.colIndex)} disabled={controlsLocked || !hasMappings} />
            </Tooltip>
          </div>

          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, marginBottom: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#fafafa', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 500, color: '#666', borderBottom: '1px solid #f0f0f0' }}>Value</th>
                  <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 500, color: '#666', borderBottom: '1px solid #f0f0f0', width: 48 }}>#</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 500, color: '#666', borderBottom: '1px solid #f0f0f0' }}>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {(table.values || [])
                  .filter(item => !table.search || item.value.toLowerCase().includes(table.search.toLowerCase()))
                  .map((item, index) => {
                    const mappedEntry = column.valueMap.find(entry => entry.from === item.value)
                    return (
                      <tr key={item.value} style={{ background: index % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '2px 8px', borderBottom: '1px solid #f5f5f5', fontFamily: 'var(--font-code)' }}>{item.value || <span style={{ color: '#ccc' }}>(empty)</span>}</td>
                        <td style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #f5f5f5', color: '#999' }}>{item.count}</td>
                        <td style={{ padding: '2px 8px', borderBottom: '1px solid #f5f5f5' }}>
                          {mappedEntry ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: '#999', fontSize: 10 }}>→</span>
                              <Input
                                size="small"
                                value={String(mappedEntry.to ?? '')}
                                onChange={event => {
                                  const entryIndex = column.valueMap.indexOf(mappedEntry)
                                  if (entryIndex >= 0) controller.updateValueMapEntry(block.id, column.colIndex, entryIndex, 'to', event.target.value)
                                }}
                                style={{ fontSize: 11, flex: 1 }}
                                disabled={controlsLocked}
                                variant="borderless"
                              />
                              <Button
                                size="small" type="text" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                                onClick={() => controller.removeMappingForValue(block.id, column.colIndex, item.value)}
                                style={{ padding: 0, minWidth: 16, height: 16 }} disabled={controlsLocked}
                              />
                            </div>
                          ) : (
                            <Button size="small" type="link" onClick={() => controller.addMappingForValue(block.id, column.colIndex, item.value)} disabled={controlsLocked} style={{ padding: 0, fontSize: 11, height: 20 }}>
                              + add mapping
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                {!table.values?.length && !table.loading && <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: '#bbb', fontSize: 11 }}>No data in column</td></tr>}
                {table.loading && <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: '#bbb', fontSize: 11 }}>Loading...</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {expanded && !table?.active && (
        <div style={{ marginTop: 4 }}>
          {column.valueMap.map((entry, index) => (
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 18px 1fr 24px', gap: '4px 6px', alignItems: 'center', marginBottom: 2 }}>
              <Input size="small" placeholder="match" value={entry.from} onChange={event => controller.updateValueMapEntry(block.id, column.colIndex, index, 'from', event.target.value)} style={{ fontSize: 12 }} disabled={controlsLocked} />
              <span style={{ textAlign: 'center', color: '#999' }}>→</span>
              <Input size="small" placeholder="output" value={String(entry.to ?? '')} onChange={event => controller.updateValueMapEntry(block.id, column.colIndex, index, 'to', event.target.value)} style={{ fontSize: 12 }} disabled={controlsLocked} />
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => controller.removeValueMapEntry(block.id, column.colIndex, index)} style={{ padding: 0, minWidth: 20 }} disabled={controlsLocked} />
            </div>
          ))}
          <Button size="small" type="dashed" block icon={<PlusOutlined />} onClick={() => controller.addValueMapEntry(block.id, column.colIndex)} style={{ fontSize: 12, marginTop: 2 }} disabled={controlsLocked}>
            Add mapping
          </Button>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>Default:</span>
          <Select
            size="small"
            value={column.valueMapFallbackType || 'auto'}
            onChange={value => controller.updateColumn(block.id, column.colIndex, { valueMapFallbackType: value })}
            options={FALLBACK_TYPE_OPTIONS}
            disabled={controlsLocked}
            style={{ flex: 1, fontSize: 11 }}
          />
        </div>
      )}
    </div>
  )
}
