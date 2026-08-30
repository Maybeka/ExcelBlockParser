import { useState } from 'react'
import { Input, Button, Tag, Tooltip } from 'antd'
import { AimOutlined, DeleteOutlined, PlusOutlined, InfoCircleOutlined, CheckOutlined, EditOutlined } from '@ant-design/icons'
import type { Tag as TagType } from '../types'
import { addTag, removeTag } from '../services/tagUtils'
import { useI18n } from '../i18n'

interface BlockCardProps {
  isActive: boolean
  label: string
  onLabelChange: (v: string) => void
  placeholder: string
  status?: 'error' | undefined
  disabled?: boolean
  labelRef?: (el: any) => void
  rangeText?: string
  onRangeClick?: () => void
  selectionLocked: boolean
  onConfirm: () => void
  onEdit: () => void
  tags?: TagType[]
  onTagsChange: (tags: TagType[]) => void
  showInfo: boolean
  onToggleInfo: () => void
  dimensionsText?: string
  onDelete: () => void
  onClick?: () => void
  children: React.ReactNode
  extra?: React.ReactNode
}

export function BlockCard({
  isActive, label, onLabelChange, placeholder, status, disabled, labelRef,
  rangeText, onRangeClick, selectionLocked, onConfirm, onEdit,
  tags, onTagsChange, showInfo, onToggleInfo, dimensionsText, onDelete, onClick,
  children, extra,
}: BlockCardProps) {
  const { t } = useI18n()
  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')

  return (
    <div className={`extractor-card ${isActive ? 'is-active' : ''}`} onClick={onClick}>
      <div className="extractor-card-header">
        <div className="extractor-card-title">
          <Input size="small" ref={labelRef} value={label}
            onChange={e => onLabelChange(e.target.value)} placeholder={placeholder}
            className="card-title-input"
            variant="borderless" disabled={disabled} status={status} />
        </div>
        <div className="extractor-card-actions">
          {!selectionLocked && rangeText && (
          <Tooltip title={t('common.confirm')}>
            <Button className="card-confirm-button" size="small" type="text" icon={<CheckOutlined />}
              onClick={e => { e.stopPropagation(); onConfirm() }} />
          </Tooltip>
          )}
          {selectionLocked && (
          <Tooltip title={t('common.edit')}>
            <Button size="small" type="text" icon={<EditOutlined />}
              onClick={e => { e.stopPropagation(); onEdit() }} />
          </Tooltip>
          )}
          {extra}
          {rangeText && <Tooltip title={t('common.focusRange')}><Button aria-label={t('common.focusRange')} size="small" type="text" icon={<AimOutlined />} onClick={e => { e.stopPropagation(); onRangeClick?.() }} onMouseDown={e => e.stopPropagation()} /></Tooltip>}
          <Tooltip title={showInfo ? t('common.hideInfo') : t('common.showInfo')}>
          <Button className={showInfo ? 'is-active' : ''} aria-label={showInfo ? t('common.hideInfo') : t('common.showInfo')} size="small" type="text" icon={<InfoCircleOutlined />}
            onClick={e => { e.stopPropagation(); onToggleInfo() }} />
          </Tooltip>
          <Button size="small" type="text" danger icon={<DeleteOutlined />}
            onClick={e => { e.stopPropagation(); onDelete() }}
            onMouseDown={e => e.stopPropagation()} disabled={disabled} />
        </div>
      </div>

      {showInfo && (
        <div className="extractor-card-info">
          <div className="extractor-card-info-row"><span>{t('common.tags')}</span><div className="extractor-card-info-value">
          {(tags || []).map((tag, i) => (
            <span key={i} className="card-info-tag">
              {i > 0 && <span className="card-info-tag-separator">/</span>}
              <Tag closable onClose={() => { const r = removeTag({ tags } as any, tag.key); onTagsChange(r.tags || []) }}
                className="card-info-tag-value">
                {tag.type === 'kv' ? `${tag.key}:${tag.value || ''}` : tag.key}
              </Tag>
            </span>
          ))}
          {tags && tags.length > 0 && <span className="card-info-tag-separator">/</span>}
          <Button size="small" type="dashed" icon={<PlusOutlined />}
            onClick={() => setAddingTag(true)}
            className="card-add-tag">{t('common.tags')}</Button>
          {addingTag && (
            <div className="card-add-tag-editor">
              <Input size="small" value={tagInput} onChange={e => setTagInput(e.target.value)}
                placeholder={t('tag.placeholder')} onPressEnter={() => {
                  if (!tagInput.trim()) return
                  const colonIdx = tagInput.indexOf(':')
                  const tag: TagType = colonIdx > 0 ? { type: 'kv', key: tagInput.slice(0, colonIdx).trim(), value: tagInput.slice(colonIdx + 1).trim() || undefined }
                    : { type: 'label', key: tagInput.trim() }
                  onTagsChange(addTag({ tags } as any, tag).tags || [])
                  setAddingTag(false); setTagInput('')
                }} className="card-add-tag-input" />
              <Button size="small" type="link" onClick={() => {
                if (!tagInput.trim()) return
                const colonIdx = tagInput.indexOf(':')
                const tag: TagType = colonIdx > 0 ? { type: 'kv', key: tagInput.slice(0, colonIdx).trim(), value: tagInput.slice(colonIdx + 1).trim() || undefined }
                  : { type: 'label', key: tagInput.trim() }
                onTagsChange(addTag({ tags } as any, tag).tags || [])
                setAddingTag(false); setTagInput('')
              }}>✓</Button>
              <Button size="small" type="text" onClick={() => { setAddingTag(false); setTagInput('') }}>✗</Button>
            </div>
          )}
          {!tags?.length && !addingTag && <span className="extractor-card-info-empty">{t('common.noTags')}</span>}
          </div></div>
          <div className="extractor-card-info-row"><span>{t('common.range')}</span><div className="extractor-card-info-value">
            {rangeText ? <span className="extractor-card-range">{rangeText}</span> : <span className="extractor-card-info-empty">{t('common.noRange')}</span>}
          </div></div>
          <div className="extractor-card-info-row"><span>{t('common.size')}</span><div className="extractor-card-info-value">{dimensionsText || '—'}</div></div>
        </div>
      )}

      <div className="extractor-card-body">
          {children}
        </div>
    </div>
  )
}
