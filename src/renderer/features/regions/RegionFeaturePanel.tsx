import { useState } from 'react'
import { Button, Modal } from 'antd'
import { PlayCircleOutlined, PlusOutlined } from '@ant-design/icons'
import type { RegionConfig } from '../../types'
import { RegionPanel } from '../../components/RegionPanel'
import styles from './RegionFeaturePanel.module.css'

export interface RegionFeaturePanelProps {
  regions: RegionConfig[]
  activeRegionId: string | null
  onAddRegion: () => void
  onDeleteRegion: (regionId: string) => void
  onRegionChange: (regionId: string, partial: Partial<RegionConfig>) => void
  onActivateRegion: (regionId: string) => void
  onRangeClick: (regionId: string) => void
  onRun: () => void
}

export function RegionFeaturePanel({
  regions,
  activeRegionId,
  onAddRegion,
  onDeleteRegion,
  onRegionChange,
  onActivateRegion,
  onRangeClick,
  onRun,
}: RegionFeaturePanelProps) {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)
  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <strong>Regions</strong>
        <span>
          <Button aria-label="Run & Preview" size="small" type="text" icon={<PlayCircleOutlined />} disabled={!regions.some(region => region.range)} onClick={onRun} />
          <Button size="small" icon={<PlusOutlined />} onClick={onAddRegion}>Add Region</Button>
        </span>
      </div>
      {regions.length ? (
        <RegionPanel
          regions={regions}
          activeRegionId={activeRegionId}
          onActivateRegion={onActivateRegion}
          onRegionChange={onRegionChange}
          onDeleteRegion={(id, label) => setDeleteTarget({ id, label })}
          onRangeClick={onRangeClick}
        />
      ) : (
        <div className={styles.empty}>No regions configured for this workbook.</div>
      )}
      <Modal
        title="Delete region"
        open={Boolean(deleteTarget)}
        okText="Delete"
        okType="danger"
        cancelText="Cancel"
        onOk={() => {
          if (deleteTarget) onDeleteRegion(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      >
        Delete "{deleteTarget?.label}"? This cannot be undone.
      </Modal>
    </div>
  )
}
