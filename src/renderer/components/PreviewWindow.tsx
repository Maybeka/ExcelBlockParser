import { useEffect, useState, useCallback } from 'react'
import { Layout, Segmented, Input, Space, Spin, Typography, Empty, Result, Alert, Button, theme, Select } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { PreviewTable } from './PreviewTable'
import { getBridge } from '../services/bridge'
import ReactJson from '@microlink/react-json-view'
import type { PreviewData } from '../types'

const { Header, Content } = Layout
const { Text } = Typography

interface PreviewWindowProps {
  /** Pre-loaded preview data (modal mode — skips bridge fetching) */
  previewData?: PreviewData | null
  /** All available blocks for switching (modal mode) */
  allBlocks?: Array<{ blockId: string; label: string }>
  /** Currently active block ID (modal mode) */
  activeBlockId?: string
  /** Called when user switches block (modal mode) */
  onBlockChange?: (blockId: string) => void
}

export function PreviewWindow({ previewData: propData, allBlocks, activeBlockId: propBlockId, onBlockChange }: PreviewWindowProps = {}) {
  const isModal = !!propData || !!allBlocks
  const { token } = theme.useToken()
  const [previewData, setPreviewData] = useState<PreviewData | null>(propData || null)
  const [visibleModes, setVisibleModes] = useState<('raw' | 'parsed')[]>(['raw', 'parsed'])
  const [searchText, setSearchText] = useState('')
  const [blockId, setBlockId] = useState<string>(propBlockId || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [showJson, setShowJson] = useState(false)

  // Sync prop data in modal mode
  useEffect(() => {
    if (isModal && propData) {
      setPreviewData(propData)
      setLoading(false)
      setError(null)
    }
  }, [propData, isModal])

  useEffect(() => {
    if (isModal && propBlockId) setBlockId(propBlockId)
  }, [propBlockId, isModal])
  const fetchData = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await getBridge().getPreviewData(id) as PreviewData | undefined
      if (data) {
        setPreviewData(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load preview data'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Listen for reload events from main process (window mode only)
  useEffect(() => {
    if (isModal) return
    const cleanup = getBridge().onPreviewReload((id: string) => {
      setBlockId(id)
      fetchData(id, true)
    })
    return cleanup
  }, [fetchData, isModal])

  useEffect(() => {
    if (isModal) return
    const params = new URLSearchParams(window.location.search)
    const idFromUrl = params.get('block')
    if (idFromUrl) {
      setBlockId(idFromUrl)
      fetchData(idFromUrl)
    }
  }, [fetchData, isModal])

  const handleModeChange = useCallback((value: string | number) => {
    const mode = value as string
    if (mode === 'raw') setVisibleModes(['raw'])
    else if (mode === 'parsed') setVisibleModes(['parsed'])
    else setVisibleModes(['raw', 'parsed'])
  }, [])

  if (!blockId) {
    return (
      <Layout style={{ height: '100vh' }}>
        <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Text type="secondary">Select a block to preview</Text>
        </Content>
      </Layout>
    )
  }

  if (error) {
    return (
      <Layout style={{ height: '100vh' }}>
        <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Result
            status="error"
            title="Failed to load"
            subTitle={error.message}
            extra={<Button type="primary" onClick={() => fetchData(blockId)}>Retry</Button>}
          />
        </Content>
      </Layout>
    )
  }

  if (loading || !previewData) {
    return (
      <Layout style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" tip="Loading preview data..." />
      </Layout>
    )
  }

  if (previewData.rawRows.length === 0 && previewData.parsedRows.length === 0) {
    return (
      <Layout style={{ height: '100vh' }}>
        <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Empty description="No data to preview" />
        </Content>
      </Layout>
    )
  }

  const modeValue = visibleModes.length === 2 ? 'both' : visibleModes[0]

  return (
    <Layout style={{ height: isModal ? '100%' : '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: '#fff',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space>
          {isModal && allBlocks && allBlocks.length > 1 && (
            <Select
              size="small"
              value={blockId}
              onChange={v => onBlockChange?.(v)}
              style={{ width: 140 }}
              options={allBlocks.map(b => ({ value: b.blockId, label: b.label }))}
            />
          )}
          <Text style={{ fontSize: 16, fontWeight: 600 }}>{previewData.label}</Text>
          <Text style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {previewData.rawRows.length} rows
          </Text>
        </Space>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <style>{`
            .mode-segmented .ant-segmented-item-selected[class] {
              color: #fff;
            }
            .mode-segmented.mode-raw .ant-segmented-item-selected { background: #8c8c8c; }
            .mode-segmented.mode-parsed .ant-segmented-item-selected { background: #1677ff; }
            .mode-segmented.mode-both .ant-segmented-item-selected {
              background: linear-gradient(90deg, #8c8c8c, #8c8c8c 50%, #1677ff 50%, #1677ff);
            }
          `}</style>
          <Segmented
            className={`mode-segmented mode-${modeValue}`}
            options={[
              { label: 'Raw', value: 'raw' },
              { label: 'Parsed', value: 'parsed' },
              { label: 'Both', value: 'both' },
            ]}
            value={modeValue}
            onChange={handleModeChange}
          />
          <Input.Search
            placeholder="Filter rows..."
            allowClear
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onSearch={value => setSearchText(value)}
            style={{ width: 250 }}
          />
          <span style={{ color: token.colorBorderSecondary, fontSize: 14, lineHeight: 1 }}>|</span>
          <Button
            size="small"
            type={showJson ? 'primary' : 'default'}
            icon={<CodeOutlined />}
            onClick={() => setShowJson(!showJson)}
          />
        </div>
      </Header>
      <Content style={{ overflow: 'auto' }}>
        {previewData.rawRows.length > 0 && previewData.parsedRows.length === 0 && (
          <Alert type="info" message="Parsed data not available — showing raw content only" banner />
        )}
        {showJson ? (
          <div style={{ padding: 0, height: '100%', overflow: 'auto', background: '#1e1e1e' }}>
            <ReactJson
              src={previewData.parsedRows}
              theme="monokai"
              displayDataTypes={true}
              displayObjectSize={true}
              enableClipboard={false}
              collapsed={1}
              style={{
                padding: 12,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: 13,
                lineHeight: 1.4,
              }}
              name={false}
              quotesOnKeys={false}
            />
          </div>
        ) : (
          <PreviewTable
            previewData={previewData}
            visibleModes={visibleModes}
            searchText={searchText}
          />
        )}
      </Content>
    </Layout>
  )
}
