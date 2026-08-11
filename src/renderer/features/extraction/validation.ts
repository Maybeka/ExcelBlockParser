import type { BlockConfig, RowFilterCondition } from '../../types'
import { validateExpression } from '../../services/pythonValidator'
import { MAX_ROW_FILTER_DEPTH } from '../../services/rowFilter'

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
    const validateCondition = (condition: RowFilterCondition, path: string, depth = 0) => {
      if (depth > MAX_ROW_FILTER_DEPTH) {
        errors.push(`Block "${block.label || 'block'}" row filter ${path} exceeds the maximum nesting depth of ${MAX_ROW_FILTER_DEPTH}.`)
        return
      }
      if (condition.type !== 'rule') {
        if (!condition.conditions.length) errors.push(`Block "${block.label || 'block'}" row filter group ${path} is empty.`)
        condition.conditions.forEach((child, index) => validateCondition(child, `${path}.${index + 1}`, depth + 1))
        return
      }
      if (condition.column !== '$row' && !availableKeys.has(condition.column)) errors.push(`Block "${block.label || 'block'}" row filter ${path} references unavailable column "${condition.column}".`)
      if ((condition.operator === 'in' || condition.operator === 'notIn') && (!condition.values?.length || condition.values.some(value => !value))) errors.push(`Block "${block.label || 'block'}" row filter ${path} requires one or more non-empty values.`)
      if (!['in', 'notIn', 'empty', 'notEmpty'].includes(condition.operator) && !condition.value) errors.push(`Block "${block.label || 'block'}" row filter ${path} requires a value.`)
      if ((condition.operator === 'regex' || condition.operator === 'notRegex')) {
        try { new RegExp(condition.value ?? '') } catch { errors.push(`Block "${block.label || 'block'}" row filter ${path} has an invalid regular expression.`) }
      }
    }
    if (block.rowFilter?.condition) validateCondition(block.rowFilter.condition, '1')
  }
  return errors
}
