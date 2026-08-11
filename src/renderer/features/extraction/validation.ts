import type { BlockConfig } from '../../types'
import { validateExpression } from '../../services/pythonValidator'

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
    if (block.range && !block.activeSheet) errors.push(`Block "${block.label || 'block'}" requires a source sheet.`)
    const keys = new Map<string, number>()
    for (const column of block.columns.filter(column => !column.skip)) {
      const key = column.key || column.suggestedKey
      if (!key) continue
      keys.set(key, (keys.get(key) ?? 0) + 1)
      if (!isValidVariableName(key)) errors.push(`Invalid key in "${block.label || 'block'}": "${key}"`)
      if (block.range && (column.colIndex < block.range.startCol || column.colIndex > block.range.endCol)) {
        errors.push(`Column "${key}" is outside block "${block.label || 'block'}" source range.`)
      }
    }
    for (const property of block.computedProperties ?? []) {
      const label = property.label.trim()
      const expressionKeys = [...keys.keys()]
      if (!label) errors.push(`Block "${block.label || 'block'}" has an unnamed downstream property.`)
      else {
        keys.set(label, (keys.get(label) ?? 0) + 1)
        if (!isValidVariableName(label)) errors.push(`Invalid downstream property in "${block.label || 'block'}": "${property.label}"`)
      }
      const validation = validateExpression(property.expression, expressionKeys)
      validation.errors.forEach(error => errors.push(`Invalid downstream property "${label || property.id}" in "${block.label || 'block'}": ${error}`))
    }
    keys.forEach((count, key) => { if (count > 1) errors.push(`Duplicate output key in "${block.label || 'block'}": "${key}"`) })
    const availableKeys = new Set(block.columns.filter(column => !column.skip).map(column => column.key || column.suggestedKey))
    for (const [index, rule] of (block.ignoreRules ?? []).entries()) {
      if (!rule.column) errors.push(`Block "${block.label || 'block'}" row filter ${index + 1} requires a column.`)
      else if (rule.column !== '$row' && !availableKeys.has(rule.column)) errors.push(`Block "${block.label || 'block'}" row filter ${index + 1} references unavailable column "${rule.column}".`)
      if (rule.operator !== 'empty' && !rule.value) errors.push(`Block "${block.label || 'block'}" row filter ${index + 1} requires a value.`)
      if (rule.operator === 'regex') {
        try { new RegExp(rule.value ?? '') } catch { errors.push(`Block "${block.label || 'block'}" row filter ${index + 1} has an invalid regular expression.`) }
      }
    }
  }
  return errors
}
