import { useState } from 'react'
import { Input, InputNumber, Button, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { RegionConfig, SplitRuleType } from '../types'
import { BlockCard } from './BlockCard'
import { useI18n } from '../i18n'

interface RegionPanelProps {
  regions: RegionConfig[]
  activeRegionId: string | null
  onActivateRegion: (regionId: string) => void
  onRegionChange: (regionId: string, partial: Partial<RegionConfig>) => void
  onDeleteRegion: (regionId: string, label: string) => void
  onRangeClick?: (regionId: string) => void
}

export function RegionPanel({ regions, activeRegionId, onActivateRegion, onRegionChange, onDeleteRegion, onRangeClick }: RegionPanelProps) {
  const { t } = useI18n()
  const [showInfoRegions, setShowInfoRegions] = useState<Set<string>>(new Set())

  if (!regions.length) return null

  return (
    <div className="region-panel" style={{ marginBottom: 12 }}>
      {regions.map(region => {
        const range = region.range
        const hasRange = range !== null
        return (
          <BlockCard
            key={region.id}
            isActive={false}
            label={region.label}
            onLabelChange={v => onRegionChange(region.id, { label: v })}
            placeholder={`Region ${regions.indexOf(region) + 1}`}
            rangeText={region.range ? `${region.activeSheet ? `${region.activeSheet}!` : ''}${region.range.a1Notation}` : undefined}
            dimensionsText={region.range ? `${region.range.endRow - region.range.startRow + 1} rows × ${region.range.endCol - region.range.startCol + 1} cols` : undefined}
            onRangeClick={() => onRangeClick?.(region.id)}
            selectionLocked={region.selectionLocked}
            onConfirm={() => onRegionChange(region.id, { selectionLocked: true })}
            onEdit={() => onRegionChange(region.id, { selectionLocked: false })}
            tags={region.tags}
            onTagsChange={tags => onRegionChange(region.id, { tags })}
            showInfo={showInfoRegions.has(region.id)}
            onToggleInfo={() => { const n = new Set(showInfoRegions); showInfoRegions.has(region.id) ? n.delete(region.id) : n.add(region.id); setShowInfoRegions(n) }}
            onDelete={() => onDeleteRegion(region.id, region.label)}
            onClick={() => onActivateRegion(region.id)}
          >
            {!hasRange ? (
              <div className="card-range-empty">
                {t('region.selectRange')}
              </div>
            ) : (
              <>
                <section className="region-editor-section">
                  <div className="region-editor-heading">
                    <span>{t('region.splitRules')}</span>
                    <Button size="small" type="text" icon={<PlusOutlined />}
                      onClick={() => { const rules = [...region.splitRules, { type: 'keyword' as SplitRuleType, keyword: '' }]; onRegionChange(region.id, { splitRules: rules }) }}>
                      {t('region.addRule')}
                    </Button>
                  </div>
                  {region.splitRules.map((rule, i) => (
                    <div key={i} className="region-split-rule">
                      <Select size="small" value={rule.type} className="region-rule-type"
                        onChange={v => { const rules = [...region.splitRules]; rules[i] = { type: v as SplitRuleType, keyword: v === 'keyword' ? '' : undefined, minGap: v === 'keyword' ? undefined : 1 }; onRegionChange(region.id, { splitRules: rules }) }}
                        options={[{ value: 'keyword', label: t('region.keyword') }, { value: 'emptyRow', label: t('region.emptyRow') }, { value: 'emptyColumn', label: t('region.emptyColumn') }]} />
                      {rule.type === 'keyword' && (
                        <Input size="small" value={rule.keyword || ''} placeholder={t('region.keywordExample')}
                          onChange={e => { const rules = [...region.splitRules]; rules[i] = { ...rules[i], keyword: e.target.value }; onRegionChange(region.id, { splitRules: rules }) }}
                          className="region-rule-value" />
                      )}
                      {rule.type !== 'keyword' && (
                        <InputNumber size="small" min={1} precision={0} value={rule.minGap ?? 1}
                          aria-label={t('region.minimumGap')}
                          onChange={value => { const rules = [...region.splitRules]; rules[i] = { ...rules[i], minGap: value ?? 1 }; onRegionChange(region.id, { splitRules: rules }) }}
                          className="region-rule-gap" />
                      )}
                      <Button size="small" type="text" danger icon={<DeleteOutlined />}
                        onClick={() => { const rules = region.splitRules.filter((_, j) => j !== i); onRegionChange(region.id, { splitRules: rules }) }} />
                    </div>
                  ))}
                  {region.splitRules.length === 0 && (
                    <div className="region-editor-empty">{t('region.noRules')}</div>
                  )}
                </section>

                {region.blocks.length > 0 && (
                  <section className="region-editor-section region-detected-section">
                    <div className="region-editor-heading"><span>{t('region.detectedBlocks')}</span><span>{region.blocks.length}</span></div>
                    <div className="region-detected-list">
                      {region.blocks.map((block, i) => (
                        <div key={block.id || i} className="region-detected-item">
                          {block.label || `Block ${i + 1}`}
                          {block.range && <span>{block.range.a1Notation}</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </BlockCard>
        )
      })}
    </div>
  )
}
