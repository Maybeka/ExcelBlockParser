import { useState } from 'react'
import { Button, Modal } from 'antd'
import type { RegionConfig } from '../../types'
import { RegionPanel } from '../../components/RegionPanel'
import styles from './RegionFeaturePanel.module.css'
import { useI18n } from '../../i18n'

export interface RegionFeaturePanelProps {
  regions: RegionConfig[]
  activeRegionId: string | null
  onDeleteRegion: (regionId: string) => void
  onRegionChange: (regionId: string, partial: Partial<RegionConfig>) => void
  onActivateRegion: (regionId: string) => void
  onRangeClick: (regionId: string) => void
}

export function RegionFeaturePanel({
  regions,
  activeRegionId,
  onDeleteRegion,
  onRegionChange,
  onActivateRegion,
  onRangeClick,
}: RegionFeaturePanelProps) {
  const { t } = useI18n()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)
  return (
    <div className={styles.panel}>
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
        <div className={styles.empty}>{t('region.configure')}</div>
      )}
      <Modal
        title={t('region.delete')}
        open={Boolean(deleteTarget)}
        okText={t('common.delete')}
        okType="danger"
        cancelText={t('common.cancel')}
        onOk={() => {
          if (deleteTarget) onDeleteRegion(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      >
        {t('region.deleteConfirm', { label: deleteTarget?.label ?? '' })}
      </Modal>
    </div>
  )
}
