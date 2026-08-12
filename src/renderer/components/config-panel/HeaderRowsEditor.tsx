import { Input } from 'antd'
import type { BlockConfig } from '../../types'

export interface HeaderRowsEditorProps {
  block: BlockConfig
  onChange: (headerRows: number[]) => void
}

/** Parses a one-based list such as "1-3, 5" into sorted zero-based rows. */
export function parseHeaderRowsInput(input: string): number[] | null {
  const trimmed = input.trim()
  if (!trimmed || /[-,]$/.test(trimmed)) return null

  const rows = new Set<number>()
  for (const part of trimmed.split(/\s*,\s*/)) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10)
      const end = Number.parseInt(rangeMatch[2], 10)
      if (start < 1 || end < 1 || start > end) return null
      for (let row = start; row <= end; row++) rows.add(row - 1)
    } else if (/^\d+$/.test(part)) {
      const row = Number.parseInt(part, 10)
      if (row < 1) return null
      rows.add(row - 1)
    } else {
      return null
    }
  }

  return rows.size ? [...rows].sort((a, b) => a - b) : null
}

export function HeaderRowsEditor({ block, onChange }: HeaderRowsEditorProps) {
  const commit = (value: string) => {
    const parsed = parseHeaderRowsInput(value)
    if (parsed) onChange(parsed)
    else if (!value.trim()) onChange([0])
  }

  const count = block.headerRows.length || 1
  return (
    <div style={{ marginTop: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>Header Rows</span>
      <Input
        size="small"
        defaultValue={block.headerRows.length ? block.headerRows.map(row => row + 1).join(', ') : ''}
        onBlur={event => commit(event.target.value)}
        onPressEnter={event => commit(event.currentTarget.value)}
        placeholder="e.g. 1-3, 5"
        style={{ flex: 1, fontSize: 13 }}
      />
      <span style={{ fontSize: 11, color: '#8c8c8c', whiteSpace: 'nowrap' }}>
        → {count} header {count === 1 ? 'row' : 'rows'}
      </span>
    </div>
  )
}
