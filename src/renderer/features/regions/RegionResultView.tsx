import { lazy, Suspense, useState } from 'react'
import { Button, Empty, Layout, Select, Table, Tooltip } from 'antd'
import { CodeOutlined, DatabaseOutlined, FileTextOutlined } from '@ant-design/icons'
import type { RegionParseResult } from '../../types'
import { useI18n } from '../../i18n'

const { Header, Content } = Layout
const JsonTreeView = lazy(async () => ({ default: (await import('../../components/JsonTreeView')).JsonTreeView }))

function columnName(index: number): string {
  let result = ''
  let value = index
  do {
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return result
}

export function RegionResultView({ results }: { results: RegionParseResult[] }) {
  const { t } = useI18n()
  const [selectedRegionId, setSelectedRegionId] = useState(() => results[0]?.regionId ?? '')
  const [showJson, setShowJson] = useState(false)
  const region = results.find(item => item.regionId === selectedRegionId) ?? results[0]
  if (!region) return null

  const rowCount = region.blocks.reduce((total, block) => total + block.rows.length, 0)

  return (
    <Layout className="preview-shell region-preview-shell" style={{ height: '100%' }}>
      <Header className="preview-header">
        <div className="preview-title-group">
          <span className="preview-title-icon"><DatabaseOutlined /></span>
          {results.length > 1 ? (
            <>
              <span className="preview-kicker preview-kicker-inline">{t('preview.regionReview')}</span>
              <Select className="preview-block-select" size="small" value={region.regionId} onChange={setSelectedRegionId}
                options={results.map(item => ({ value: item.regionId, label: item.label || item.regionId }))} />
            </>
          ) : (
            <div className="preview-title-copy">
              <span className="preview-kicker">{t('preview.regionReview')}</span>
              <strong>{region.label || t('workspace.regions')}</strong>
            </div>
          )}
          <div className="preview-metrics" aria-label={t('preview.regionSummary')}>
            <span><b>{region.blocks.length}</b> {t('workspace.blocks')}</span>
            <span><b>{rowCount}</b> {t('common.rows')}</span>
          </div>
        </div>
        <div className="preview-controls">
          <Tooltip title={showJson ? t('preview.showTable') : t('preview.showJson')}>
            <Button aria-label={showJson ? t('preview.showTable') : t('preview.showJson')} type={showJson ? 'primary' : 'default'} icon={<CodeOutlined />} onClick={() => setShowJson(value => !value)} />
          </Tooltip>
        </div>
      </Header>
      <div className="preview-context-bar"><span><i className="preview-parsed-dot" />{t('preview.detectedRanges')}</span></div>
      <Content className="preview-content">
        {showJson ? (
          <div className="preview-json">
            <div className="preview-json-heading"><FileTextOutlined /> {t('preview.regionJson')}</div>
            <Suspense fallback={null}><JsonTreeView value={region} collapsed={1} /></Suspense>
          </div>
        ) : region.blocks.length === 0 ? (
          <Empty className="region-preview-empty" description={t('preview.noBlocks')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="region-preview-content">
            {region.blocks.map((block, blockIndex) => {
              const columnCount = Math.max(...block.rows.map(row => row.length), 0)
              return (
                <section key={`${block.blockLabel}-${blockIndex}`} className="region-preview-block">
                  <div className="region-preview-block-heading">
                    <strong>{block.blockLabel}</strong>
                    <span>{block.rows.length} {t('common.rows')} · {columnCount} {t('common.cols')}</span>
                  </div>
                  <Table
                    className="preview-table region-preview-table"
                    dataSource={block.rows.map((row, rowIndex) => ({ key: rowIndex, rowIndex, ...Object.fromEntries(row.map((cell, columnIndex) => [`c${columnIndex}`, cell])) }))}
                    columns={[
                      { title: '#', key: 'rowIndex', width: 48, render: (_: unknown, record: { rowIndex: number }) => <span className="preview-row-number">{record.rowIndex + 1}</span> },
                      ...Array.from({ length: columnCount }, (_, columnIndex) => ({ title: columnName(columnIndex), dataIndex: `c${columnIndex}`, key: `c${columnIndex}`, width: 120, ellipsis: true })),
                    ]}
                    size="small"
                    bordered
                    pagination={false}
                    rowClassName="preview-row-raw"
                    scroll={{ x: 'max-content' }}
                    sticky
                  />
                </section>
              )
            })}
          </div>
        )}
      </Content>
    </Layout>
  )
}
