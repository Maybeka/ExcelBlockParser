import { useState } from 'react'
import { Input, InputNumber, Button, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { RegionConfig, SplitRuleType } from '../types'
import { BlockCard } from './BlockCard'

interface RegionPanelProps {
  regions: RegionConfig[]
  activeRegionId: string | null
  onActivateRegion: (regionId: string) => void
  onRegionChange: (regionId: string, partial: Partial<RegionConfig>) => void
  onDeleteRegion: (regionId: string, label: string) => void
  onRangeClick?: (regionId: string) => void
}

export function RegionPanel({ regions, activeRegionId, onActivateRegion, onRegionChange, onDeleteRegion, onRangeClick }: RegionPanelProps) {
  const [showTagsRegions, setShowTagsRegions] = useState<Set<string>>(new Set())

  if (!regions.length) return null

  return (
    <div className="region-panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>Regions</h3>
      </div>

      {regions.map(region => {
        const range = region.range
        const hasRange = range !== null
        return (
          <BlockCard
            key={region.id}
            isActive={region.id === activeRegionId}
            collapsed={region.collapsed}
            onToggle={() => onRegionChange(region.id, { collapsed: !region.collapsed })}
            label={region.label}
            onLabelChange={v => onRegionChange(region.id, { label: v })}
            placeholder={`Region ${regions.indexOf(region) + 1}`}
            rangeText={region.range ? `${region.activeSheet ? `${region.activeSheet}!` : ''}${region.range.a1Notation}` : undefined}
            onRangeClick={() => onRangeClick?.(region.id)}
            selectionLocked={region.selectionLocked}
            onConfirm={() => onRegionChange(region.id, { selectionLocked: true })}
            onEdit={() => onRegionChange(region.id, { selectionLocked: false })}
            tags={region.tags}
            onTagsChange={tags => onRegionChange(region.id, { tags })}
            showTags={showTagsRegions.has(region.id)}
            onToggleTags={() => { const n = new Set(showTagsRegions); showTagsRegions.has(region.id) ? n.delete(region.id) : n.add(region.id); setShowTagsRegions(n) }}
            onDelete={() => onDeleteRegion(region.id, region.label)}
            onClick={() => onActivateRegion(region.id)}
          >
            {!hasRange ? (
              <div style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>
                Click and drag in the spreadsheet to select a region range.
              </div>
            ) : (
              <>
                <div style={{
                  background: '#f5f5f5', padding: '6px 10px', borderRadius: 4,
                  fontSize: 12, fontFamily: 'monospace', marginBottom: 8,
                }}>
                  {range.endRow - range.startRow + 1} rows
                  {' × '}
                  {range.endCol - range.startCol + 1} cols
                  {region.blocks.length > 0 && (
                    <span style={{ fontSize: 12, color: '#999' }}>
                      {' → '}{region.blocks.length} blocks detected
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#666', fontWeight: 500 }}>Split Rules</span>
                    <Button size="small" type="link" icon={<PlusOutlined />}
                      onClick={() => { const rules = [...region.splitRules, { type: 'keyword' as SplitRuleType, keyword: '' }]; onRegionChange(region.id, { splitRules: rules }) }}>
                      Add Rule
                    </Button>
                  </div>
                  {region.splitRules.map((rule, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                      <Select size="small" value={rule.type} style={{ width: 110, height: 22, fontSize: 13 }}
                        onChange={v => { const rules = [...region.splitRules]; rules[i] = { type: v as SplitRuleType, keyword: v === 'keyword' ? '' : undefined, minGap: v === 'keyword' ? undefined : 1 }; onRegionChange(region.id, { splitRules: rules }) }}
                        options={[{ value: 'keyword', label: 'Keyword' }, { value: 'emptyRow', label: 'Empty Row' }, { value: 'emptyColumn', label: 'Empty Col' }]} />
                      {rule.type === 'keyword' && (
                        <Input size="small" value={rule.keyword || ''} placeholder="e.g. ---"
                          onChange={e => { const rules = [...region.splitRules]; rules[i] = { ...rules[i], keyword: e.target.value }; onRegionChange(region.id, { splitRules: rules }) }}
                          style={{ flex: 1, height: 22, fontSize: 13 }} />
                      )}
                      {rule.type !== 'keyword' && (
                        <InputNumber size="small" min={1} precision={0} value={rule.minGap ?? 1}
                          aria-label="Minimum consecutive gap"
                          onChange={value => { const rules = [...region.splitRules]; rules[i] = { ...rules[i], minGap: value ?? 1 }; onRegionChange(region.id, { splitRules: rules }) }}
                          style={{ width: 72 }} />
                      )}
                      <Button size="small" type="text" danger icon={<DeleteOutlined />}
                        onClick={() => { const rules = region.splitRules.filter((_, j) => j !== i); onRegionChange(region.id, { splitRules: rules }) }} />
                    </div>
                  ))}
                  {region.splitRules.length === 0 && (
                    <div style={{ color: '#bbb', fontSize: 11 }}>No split rules. Add a rule to auto-detect blocks.</div>
                  )}
                </div>

                {region.blocks.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 8, marginBottom: 8 }}>
                    <span style={{ color: '#666', fontWeight: 500 }}>Detected Blocks ({region.blocks.length})</span>
                    <div style={{ marginTop: 4 }}>
                      {region.blocks.map((block, i) => (
                        <div key={block.id || i} style={{ padding: '2px 6px', color: '#999', fontSize: 11 }}>
                          {block.label || `Block ${i + 1}`}
                          {block.range && <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{block.range.a1Notation}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </BlockCard>
        )
      })}
    </div>
  )
}
