import { useEffect, useState, useCallback } from 'react'
import { Layout, Segmented, Input, Spin, Typography, Empty, Result, Alert, Button, Select, Tooltip } from 'antd'
import { CodeOutlined, CloseOutlined, DatabaseOutlined, FileTextOutlined, SearchOutlined } from '@ant-design/icons'
import { PreviewTable } from './PreviewTable'
import type { PreviewData } from '../types'
import { JsonTreeView } from './JsonTreeView'
import { useI18n } from '../i18n'

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
  /** Source range supplied by the workspace for the selected block. */
  rangeText?: string
  /** Closes the modal preview when rendered inside the main workspace. */
  onClose?: () => void
}

export function PreviewWindow({ dataSource, previewData: propData, allBlocks, activeBlockId: propBlockId, onBlockChange, rangeText, onClose }: PreviewWindowProps = {}) {
  const { t } = useI18n()
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
      if (!dataSource) throw new Error(t('preview.sourceUnavailable'))
      const data = await dataSource.getData(id)
      if (data) {
        setPreviewData(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(t('preview.loadFailed')))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [dataSource, t])

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
          <Text type="secondary">{t('extract.select')}</Text>
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
            title={t('preview.noData')}
            subTitle={error.message}
            extra={<Button type="primary" onClick={() => fetchData(blockId)}>{t('common.retry')}</Button>}
          />
        </Content>
      </Layout>
    )
  }

  if (loading || !previewData) {
    return (
      <Layout style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" tip={t('common.preview')} />
      </Layout>
    )
  }

  if (previewData.rawRows.length === 0 && previewData.parsedRows.length === 0) {
    return (
      <Layout style={{ height: '100vh' }}>
        <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Empty description={t('preview.noData')} />
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
          {isModal && allBlocks && allBlocks.length > 1 ? (
            <>
              <span className="preview-kicker preview-kicker-inline">{t('preview.parseReview')}</span>
              <Select className="preview-block-select" size="small" value={blockId} onChange={v => onBlockChange?.(v)} options={allBlocks.map(b => ({ value: b.blockId, label: b.label }))} />
            </>
          ) : <div className="preview-title-copy">
            <span className="preview-kicker">{t('preview.parseReview')}</span>
            <strong>{previewData.label}</strong>
          </div>}
          <div className="preview-metrics" aria-label={t('preview.summary')}>
            <span><b>{matchingRows}</b> {t('common.rows')}</span>
            <span><b>{previewData.columns.length}</b> {t('common.cols')}</span>
          </div>
        </div>
        <div className="preview-controls">
          <Segmented
            className={`preview-mode-control preview-mode-${modeValue}`}
            options={[
              { label: t('preview.raw'), value: 'raw' },
              { label: t('preview.parsed'), value: 'parsed' },
              { label: t('preview.both'), value: 'both' },
            ]}
            value={modeValue}
            onChange={handleModeChange}
          />
          <Input.Search
            className="preview-search"
            placeholder={t('preview.filter')}
            allowClear
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onSearch={value => setSearchText(value)}
          />
          <Tooltip title={showJson ? t('preview.showTable') : t('preview.showJson')}><Button aria-label={showJson ? t('preview.showTable') : t('preview.showJson')} type={showJson ? 'primary' : 'default'} icon={<CodeOutlined />} onClick={() => setShowJson(!showJson)} /></Tooltip>
          {onClose && <Tooltip title={t('common.close')}><Button aria-label={t('common.close')} icon={<CloseOutlined />} onClick={onClose} /></Tooltip>}
        </div>
      </Header>
      <div className="preview-context-bar">
        <span><i className="preview-raw-dot" />{t('preview.sourceCells')}</span>
        <span><i className="preview-parsed-dot" />{t('preview.parsedOutput')}</span>
        {searchText && <span className="preview-filter-state">{t('preview.filtering', { value: searchText })}</span>}
      </div>
      <Content className="preview-content">
        {previewData.rawRows.length > 0 && previewData.parsedRows.length === 0 && (
          <Alert type="info" message={t('preview.rawOnly')} banner />
        )}
        {showJson ? (
          <div className="preview-json">
            <div className="preview-json-heading"><FileTextOutlined /> {t('preview.outputJson')}</div>
            <JsonTreeView value={previewData.parsedRows} collapsed={1} />
          </div>
        ) : (
          <>
            <div className="preview-result-summary">
              <strong>{previewData.label}{rangeText ? ` · ${rangeText}` : ''}</strong>
              <span>{previewData.rawRows.length} {t('common.rows')} · {previewData.columns.length} {t('common.cols')}</span>
            </div>
            <PreviewTable
              previewData={previewData}
              visibleModes={visibleModes}
              searchText={searchText}
            />
          </>
        )}
      </Content>
    </Layout>
  )
}
