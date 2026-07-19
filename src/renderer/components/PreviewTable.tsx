import { useMemo } from 'react'
import { Table, Empty } from 'antd'
import type { PreviewData } from '../types'

function formatTypedValue(val: unknown): string {
  if (val === null) return 'null'
  if (val === undefined) return ''
  if (typeof val === 'string') return `"${val}"`
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return String(val)
  return String(val)
}

interface PreviewTableProps {
  previewData: PreviewData
  visibleModes: ('raw' | 'parsed')[]
  searchText: string
}

interface FlatRow {
  key: string
  type: 'raw' | 'parsed'
  rowIndex: number
  cells: string[]
  /** Original parsed values (undefined for raw rows) — used for type-aware display */
  parsedValues?: unknown[]
}

export function PreviewTable({ previewData, visibleModes, searchText }: PreviewTableProps) {
  const { columns, rawRows, parsedRows, rawColIndices } = previewData

  const flatRows: FlatRow[] = useMemo(() => {
    const result: FlatRow[] = []
    const maxCount = Math.max(rawRows.length, parsedRows.length)
    const hasRaw = visibleModes.includes('raw')
    const hasParsed = visibleModes.includes('parsed')

    for (let i = 0; i < maxCount; i++) {
      if (hasRaw && i < rawRows.length) {
        const raw = rawRows[i]
        result.push({
          key: `r${i}`,
          type: 'raw',
          rowIndex: i,
          cells: columns.map((_, ci) => {
            const ri = rawColIndices[ci]
            if (raw && ri < raw.length) return String(raw[ri] ?? '')
            return ''
          }),
        })
      }
      if (hasParsed && i < parsedRows.length) {
        const parsedRow = parsedRows[i] ?? {}
        const values = columns.map(col => parsedRow[col])
        result.push({
          key: `p${i}`,
          type: 'parsed',
          rowIndex: i,
          cells: values.map(v => String(v ?? '')),
          parsedValues: values,
        })
      }
    }
    return result
  }, [rawRows, parsedRows, columns, visibleModes])

  const filteredRows = useMemo(() => {
    if (!searchText) return flatRows
    const lower = searchText.toLowerCase()
    return flatRows.filter(row =>
      row.cells.some(cell => cell.toLowerCase().includes(lower)),
    )
  }, [flatRows, searchText])

  const dataColumns = useMemo(() => {
    return columns.map((col, idx) => ({
      title: col,
      key: col,
      render: (_: unknown, record: FlatRow) => {
        if (idx >= record.cells.length) return ''
        // For parsed rows: format with type indicators (strings quoted, null/undefined explicit)
        if (record.type === 'parsed' && record.parsedValues && idx < record.parsedValues.length) {
          return formatTypedValue(record.parsedValues[idx])
        }
        return record.cells[idx]
      },
      ellipsis: true,
    }))
  }, [columns])

  const tableColumns = useMemo(() => {
    return [
      {
        title: '#',
        key: 'rowIndex',
        width: 48,
        render: (_: unknown, record: FlatRow) => (
          <span className="preview-row-number">{record.rowIndex + 1}</span>
        ),
      },
      {
        title: 'Type',
        key: 'type',
        width: 62,
        render: (_: unknown, record: FlatRow) => <span className={`preview-source-tag preview-source-${record.type}`}>{record.type === 'raw' ? 'RAW' : 'PARSED'}</span>,
      },
      ...dataColumns,
    ]
  }, [dataColumns, visibleModes])

  if (flatRows.length === 0) {
    return <Empty description="No data to preview" />
  }

  return (
    <div className="preview-table-wrap">
      <Table
        className="preview-table"
        dataSource={filteredRows}
        columns={tableColumns}
        rowKey="key"
        size="small"
        bordered
        pagination={false}
        locale={{
          emptyText: <Empty description="No data to preview" />,
        }}
        onRow={() => ({})}
        rowClassName={(record: FlatRow) => {
          const pairClass = visibleModes.length === 2 ? (record.type === 'raw' ? 'preview-pair-start' : 'preview-pair-end') : ''
          return `preview-row-${record.type} ${pairClass}`
        }}
        scroll={{ x: 'max-content' }}
        sticky
      />
    </div>
  )
}
