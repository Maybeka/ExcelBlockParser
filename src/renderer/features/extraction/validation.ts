import type { BlockConfig } from '../../types'

export function isValidVariableName(name: string): boolean {
  if (!name.trim()) return true
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

export function validateBlocks(blocks: BlockConfig[]): string[] {
  const errors: string[] = []
  const labels = new Map<string, { count: number; label: string }>()
  for (const block of blocks) {
    const label = (block.label || '').trim()
    if (!label) continue
    const key = `${block.workbookId ?? 'unassigned'}\u0000${label}`
    const current = labels.get(key)
    labels.set(key, { count: (current?.count ?? 0) + 1, label })
  }
  labels.forEach(({ count, label }) => { if (count > 1) errors.push(`Duplicate block name: "${label}"`) })
  for (const block of blocks) {
    if (block.label && !isValidVariableName(block.label)) errors.push(`Invalid block name: "${block.label}"`)
    const keys = new Map<string, number>()
    for (const column of block.columns) {
      const key = column.key || column.suggestedKey
      if (!key) continue
      keys.set(key, (keys.get(key) ?? 0) + 1)
      if (!isValidVariableName(key)) errors.push(`Invalid key in "${block.label || 'block'}": "${key}"`)
    }
    keys.forEach((count, key) => { if (count > 1) errors.push(`Duplicate key in "${block.label || 'block'}": "${key}"`) })
  }
  return errors
}
