import { useEffect, useState, useCallback } from 'react'
import { Layout, Segmented, Input, Spin, Typography, Empty, Result, Alert, Button, Select, Tooltip } from 'antd'
import { CodeOutlined, CloseOutlined, DatabaseOutlined, FileTextOutlined, SearchOutlined } from '@ant-design/icons'
import { PreviewTable } from './PreviewTable'
import type { PreviewData } from '../types'
import { JsonTreeView } from './JsonTreeView'

const { Header, Content } = Layout
const { Text } = Typography

export interface PreviewDataSource {
  getData(blockId: string): Promise<PreviewData | undefined>
  onReload(callback: (blockId: string) => void): () => void
}

interface PreviewWindowProps {
  dataSource?: PreviewDataSource
  /** Pre-loaded preview data (modal mode — skips bridge fetching) */
  previewData?: PreviewData | null
  /** All available blocks for switching (modal mode) */
  allBlocks?: Array<{ blockId: string; label: string }>
  /** Currently active block ID (modal mode) */
  activeBlockId?: string
  /** Called when user switches block (modal mode) */
  onBlockChange?: (blockId: string) => void
  /** Closes the modal preview when rendered inside the main workspace. */
  onClose?: () => void
}

export function PreviewWindow({ dataSource, previewData: propData, allBlocks, activeBlockId: propBlockId, onBlockChange, onClose }: PreviewWindowProps = {}) {
  const isModal = !!propData || !!allBlocks
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
      if (!dataSource) throw new Error('Preview data source is unavailable')
      const data = await dataSource.getData(id)
      if (data) {
        setPreviewData(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load preview data'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [dataSource])

  // Listen for reload events from main process (window mode only)
  useEffect(() => {
    if (isModal || !dataSource) return
    const cleanup = dataSource.onReload((id: string) => {
      setBlockId(id)
      fetchData(id, true)
    })
    return cleanup
  }, [dataSource, fetchData, isModal])

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
  const matchingRows = Math.max(previewData.rawRows.length, previewData.parsedRows.length)

  return (
    <Layout className="preview-shell" style={{ height: isModal ? '100%' : '100vh' }}>
      <Header className="preview-header">
        <div className="preview-title-group">
          <span className="preview-title-icon"><DatabaseOutlined /></span>
          <div className="preview-title-copy">
            <span className="preview-kicker">PARSE REVIEW</span>
            {isModal && allBlocks && allBlocks.length > 1 ? (
              <Select className="preview-block-select" size="small" value={blockId} onChange={v => onBlockChange?.(v)} options={allBlocks.map(b => ({ value: b.blockId, label: b.label }))} />
            ) : <strong>{previewData.label}</strong>}
          </div>
          <div className="preview-metrics" aria-label="Preview summary">
            <span><b>{matchingRows}</b> rows</span>
            <span><b>{previewData.columns.length}</b> fields</span>
          </div>
        </div>
        <div className="preview-controls">
          <Segmented
            className={`preview-mode-control preview-mode-${modeValue}`}
            options={[
              { label: 'Raw', value: 'raw' },
              { label: 'Parsed', value: 'parsed' },
              { label: 'Both', value: 'both' },
            ]}
            value={modeValue}
            onChange={handleModeChange}
          />
          <Input.Search
            className="preview-search"
            placeholder="Filter values"
            allowClear
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onSearch={value => setSearchText(value)}
          />
          <Tooltip title={showJson ? 'Show table' : 'Show JSON'}><Button aria-label={showJson ? 'Show table' : 'Show JSON'} type={showJson ? 'primary' : 'default'} icon={<CodeOutlined />} onClick={() => setShowJson(!showJson)} /></Tooltip>
          {onClose && <Tooltip title="Close preview"><Button aria-label="Close preview" icon={<CloseOutlined />} onClick={onClose} /></Tooltip>}
        </div>
      </Header>
      <div className="preview-context-bar">
        <span><i className="preview-raw-dot" />Source cells</span>
        <span><i className="preview-parsed-dot" />Parsed output</span>
        {searchText && <span className="preview-filter-state">Filtering: {searchText}</span>}
      </div>
      <Content className="preview-content">
        {previewData.rawRows.length > 0 && previewData.parsedRows.length === 0 && (
          <Alert type="info" message="Parsed data not available — showing raw content only" banner />
        )}
        {showJson ? (
          <div className="preview-json">
            <div className="preview-json-heading"><FileTextOutlined /> Parsed output JSON</div>
            <JsonTreeView value={previewData.parsedRows} collapsed={1} />
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
