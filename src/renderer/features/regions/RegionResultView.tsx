import { Empty, Table } from 'antd'
import type { RegionParseResult } from '../../types'

export function RegionResultView({ results }: { results: RegionParseResult[] }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12 }}>
      {results.map(region => (
        <div key={region.regionId} style={{ marginBottom: 24 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#1677ff', fontWeight: 600 }}>
            {region.label || 'Region'}
          </h4>
          {region.blocks.length === 0 ? (
            <Empty description="No blocks detected" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : region.blocks.map((block, blockIndex) => (
            <div key={blockIndex} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                {block.blockLabel} ({block.rows.length} rows x {block.rows[0]?.length ?? 0} cols)
              </div>
              <Table
                dataSource={block.rows.map((row, rowIndex) => ({ key: rowIndex, ...Object.fromEntries(row.map((cell, columnIndex) => [`c${columnIndex}`, cell])) }))}
                columns={Array.from({ length: Math.max(...block.rows.map(row => row.length), 0) }, (_, columnIndex) => ({
                  title: String(columnIndex),
                  dataIndex: `c${columnIndex}`,
                  key: `c${columnIndex}`,
                  width: 120,
                  ellipsis: true,
                }))}
                size="small"
                pagination={false}
                bordered
                scroll={{ x: 'max-content' }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
