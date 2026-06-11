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
        width: 45,
        onCell: (record: FlatRow) => {
          const isMerged = visibleModes.length === 2 && record.type === 'raw'
          const style: React.CSSProperties = isMerged
            ? {
                background: `linear-gradient(to bottom, #8c8c8c 50%, #1677ff 50%) right / 3px 100% no-repeat, #fafafa`,
              }
            : {
                background: '#fafafa',
                boxShadow: `inset -3px 0 0 0 ${record.type === 'raw' ? '#8c8c8c' : '#1677ff'}`,
              }
          const className = 'idx-cell'
          if (visibleModes.length === 2) {
            return { style, className, rowSpan: record.type === 'raw' ? 2 : 0 }
          }
          return { style, className }
        },
        render: (_: unknown, record: FlatRow) => (
          <span>{record.rowIndex + 1}</span>
        ),
      },
      ...dataColumns,
    ]
  }, [dataColumns, visibleModes])

  if (flatRows.length === 0) {
    return <Empty description="No data to preview" />
  }

  return (
    <div style={{ fontSize: 12 }}>
      <style>{`
        .ant-table.dense-table {
          border-radius: 0 !important;
        }
        .dense-table .ant-table-cell {
          padding: 2px 6px !important;
          line-height: 1.3;
          border-color: #bbb !important;
        }
        .dense-table .ant-table-container {
          border-radius: 0 !important;
        }
        .dense-table .ant-table-header {
          border-radius: 0 !important;
        }
        .dense-table .ant-table-thead > tr > th {
          padding: 3px 6px !important;
          font-size: 13px;
          font-weight: 600;
          text-align: center !important;
          border-radius: 0 !important;
        }
        .dense-table .idx-cell {
          text-align: center !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          color: rgba(0, 0, 0, 0.88) !important;
        }
        .dense-table tr.pair-end > td {
          border-bottom: 4px solid #d9d9d9 !important;
        }
        .dense-table tr.pair-start > td:first-child {
          border-bottom: 4px solid #d9d9d9 !important;
        }
      `}</style>
      <Table
        className="dense-table"
        dataSource={filteredRows}
        columns={tableColumns}
        rowKey="key"
        size="small"
        bordered
        pagination={false}
        locale={{
          emptyText: <Empty description="No data to preview" />,
        }}
        onRow={(record: FlatRow) => ({
          style: {
            backgroundColor: record.type === 'raw' ? '#fafafa' : '#f5f9ff',
          },
        })}
        rowClassName={(record: FlatRow) => {
          if (visibleModes.length === 2) {
            return record.type === 'raw' ? 'pair-start' : 'pair-end'
          }
          return ''
        }}
        scroll={{ x: 'max-content' }}
        sticky
      />
    </div>
  )
}
