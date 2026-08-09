import { useState } from 'react'
import { Input, Button, Tag, Tooltip, Divider } from 'antd'
import { CaretDownOutlined, CaretRightOutlined, DeleteOutlined, PlusOutlined, TagOutlined, CheckOutlined, EditOutlined } from '@ant-design/icons'
import type { Tag as TagType } from '../types'
import { addTag, removeTag } from '../services/tagUtils'

interface BlockCardProps {
  isActive: boolean
  collapsed: boolean
  onToggle: () => void
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
  showTags: boolean
  onToggleTags: () => void
  onDelete: () => void
  onClick?: () => void
  children: React.ReactNode
  extra?: React.ReactNode
}

export function BlockCard({
  isActive, collapsed, onToggle, label, onLabelChange, placeholder, status, disabled, labelRef,
  rangeText, onRangeClick, selectionLocked, onConfirm, onEdit,
  tags, onTagsChange, showTags, onToggleTags,   onDelete, onClick,
  children, extra,
}: BlockCardProps) {
  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')

  return (
    <div className={`telegram-card ${isActive ? 'is-active' : ''}`} onClick={onClick} style={{
      marginBottom: 8,
      border: `1px solid ${isActive ? '#1677ff' : '#d9d9d9'}`,
      borderRadius: 6,
      borderLeft: isActive ? '3px solid #1677ff' : '3px solid transparent',
      background: isActive ? '#f0f5ff' : '#fafafa',
      transition: 'border-color 0.15s, background 0.15s',
    }}>
      <div className="telegram-card-header" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        borderBottom: collapsed ? 'none' : '1px solid #f0f0f0',
      }}>
        <span onClick={onToggle}
          style={{ color: disabled ? '#d9d9d9' : '#999', cursor: disabled ? 'default' : 'pointer', fontSize: 12 }}>
          {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
        </span>
        <Input size="small" ref={labelRef} value={label}
          onChange={e => onLabelChange(e.target.value)} placeholder={placeholder}
          style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
          variant="borderless" disabled={disabled} status={status} />
        {rangeText && (
          <Tooltip title={`${rangeText} — click to go`}>
            <span onClick={e => { e.stopPropagation(); onRangeClick?.() }}
              onMouseDown={e => e.stopPropagation()}
              style={{ fontSize: 12, color: '#1677ff', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
              {rangeText}
            </span>
          </Tooltip>
        )}
        {!selectionLocked && rangeText && (
          <Tooltip title="Confirm">
            <Button size="small" type="text" icon={<CheckOutlined style={{ color: '#52c41a' }} />}
              onClick={e => { e.stopPropagation(); onConfirm() }} />
          </Tooltip>
        )}
        {selectionLocked && (
          <Tooltip title="Edit">
            <Button size="small" type="text" icon={<EditOutlined />}
              onClick={e => { e.stopPropagation(); onEdit() }} />
          </Tooltip>
        )}
        {extra}
        <Divider type="vertical" style={{ margin: '0 2px', borderColor: '#d9d9d9' }} />
        <Tooltip title={showTags ? 'Hide tags' : 'Show tags'}>
          <Button size="small" type="text" icon={<TagOutlined />}
            onClick={e => { e.stopPropagation(); onToggleTags() }}
            style={{ color: showTags ? '#1677ff' : undefined }}>
            {tags?.length ? <span style={{ fontSize: 11, marginLeft: 4 }}>{tags.length}</span> : null}
          </Button>
        </Tooltip>
        <Divider type="vertical" style={{ margin: '0 2px', borderColor: '#d9d9d9' }} />
        <Button size="small" type="text" danger icon={<DeleteOutlined />}
          onClick={e => { e.stopPropagation(); onDelete() }}
          onMouseDown={e => e.stopPropagation()} disabled={disabled} />
      </div>

      {!collapsed && showTags && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px 4px 34px', overflow: 'auto' }}>
          {(tags || []).map((tag, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, fontSize: 11, color: '#1677ff', whiteSpace: 'nowrap' }}>
              {i > 0 && <span style={{ color: '#bbb', margin: '0 2px' }}>/</span>}
              <Tag closable onClose={() => { const r = removeTag({ tags } as any, tag.key); onTagsChange(r.tags || []) }}
                style={{ margin: 0, fontSize: 11 }}>
                {tag.type === 'kv' ? `${tag.key}:${tag.value || ''}` : tag.key}
              </Tag>
            </span>
          ))}
          {tags && tags.length > 0 && <span style={{ color: '#bbb', margin: '0 2px' }}>/</span>}
          <Button size="small" type="dashed" icon={<PlusOutlined />}
            onClick={() => setAddingTag(true)}
            style={{ fontSize: 11, height: 22, padding: '0 6px', flexShrink: 0 }}>Tag</Button>
          {addingTag && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              <Input size="small" value={tagInput} onChange={e => setTagInput(e.target.value)}
                placeholder="tag or key:value" onPressEnter={() => {
                  if (!tagInput.trim()) return
                  const colonIdx = tagInput.indexOf(':')
                  const tag: TagType = colonIdx > 0 ? { type: 'kv', key: tagInput.slice(0, colonIdx).trim(), value: tagInput.slice(colonIdx + 1).trim() || undefined }
                    : { type: 'label', key: tagInput.trim() }
                  onTagsChange(addTag({ tags } as any, tag).tags || [])
                  setAddingTag(false); setTagInput('')
                }} style={{ width: 130, fontSize: 12 }} />
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
        </div>
      )}

      {!collapsed && (
        <div className="telegram-card-body" style={{ padding: '8px 12px', opacity: selectionLocked ? 0.5 : 1 }}>
          {children}
        </div>
      )}
    </div>
  )
}
