import { Button, Input, Tooltip } from 'antd'
import { CaretDownOutlined, CaretRightOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { BlockConfig } from '../../types'
import { validateExpression } from '../../services/pythonValidator'
import { useI18n } from '../../i18n'

export interface DownstreamPropertiesEditorProps {
  block: BlockConfig
  expanded: boolean
  duplicateKeys: Set<string>
  onToggle: () => void
  onChange: (partial: Partial<BlockConfig>) => void
}

export function DownstreamPropertiesEditor({ block, expanded, duplicateKeys, onToggle, onChange }: DownstreamPropertiesEditorProps) {
  const { t } = useI18n()
  const properties = block.computedProperties || []
  const columnKeys = block.columns.filter(column => !column.skip).map(column => column.key || column.suggestedKey)

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Tooltip title={t('properties.help')}>
          <span style={{ fontSize: 11, color: '#999', cursor: 'pointer', userSelect: 'none' }} onClick={onToggle}>
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
            {' '}{t('properties.title')} {properties.length ? `(${properties.length})` : ''}
          </span>
        </Tooltip>
        {expanded && (
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => onChange({
            computedProperties: [...properties, { id: `cp-${Date.now()}`, label: '', expression: '' }],
          })}>{t('properties.add')}</Button>
        )}
      </div>

      {expanded && properties.map((property, index) => {
        const validation = property.expression ? validateExpression(property.expression, columnKeys) : { valid: true, errors: [] }
        const update = (partial: Partial<typeof property>) => {
          const next = [...properties]
          next[index] = { ...next[index], ...partial }
          onChange({ computedProperties: next })
        }
        return (
          <div key={property.id} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Input
                size="small" value={property.label} placeholder={t('properties.name')}
                status={duplicateKeys.has(property.label?.trim() || '') ? 'error' : undefined}
                onChange={event => update({ label: event.target.value })}
                style={{ width: 100, height: 22, fontSize: 13 }}
              />
              <Input
                size="small" value={property.expression} placeholder={t('properties.expressionExample')}
                onChange={event => update({ expression: event.target.value })}
                style={{ flex: 1, fontFamily: 'var(--font-code)', height: 22, fontSize: 13 }}
                status={property.expression && !validation.valid ? 'error' : undefined}
              />
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onChange({ computedProperties: properties.filter((_, itemIndex) => itemIndex !== index) })} />
            </div>
            {property.expression && !validation.valid && validation.errors.map((error, errorIndex) => <div key={errorIndex} style={{ fontSize: 10, color: '#ff4d4f' }}>{error}</div>)}
            {property.expression && validation.valid && <div style={{ fontSize: 10, color: '#52c41a' }}>✓ {t('properties.valid')}</div>}
            {duplicateKeys.has(property.label?.trim() || '') && <div style={{ fontSize: 10, color: '#ff4d4f' }}>{t('properties.duplicate')}</div>}
          </div>
        )
      })}
      {expanded && !properties.length && <div style={{ fontSize: 11, color: '#bbb' }}>{t('properties.none')}</div>}
    </div>
  )
}
