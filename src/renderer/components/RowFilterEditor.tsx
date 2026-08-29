import { Button, Checkbox, Input, Popconfirm, Segmented, Select, Tooltip } from 'antd'
import { DeleteOutlined, FolderAddOutlined, PlusOutlined } from '@ant-design/icons'
import type { RowFilterCondition, RowFilterConfig, RowFilterGroup, RowFilterOperator, RowFilterRule } from '../types'
import { DEFAULT_ROW_FILTER, MAX_ROW_FILTER_DEPTH } from '../services/rowFilter'

interface RowFilterEditorProps {
  config?: RowFilterConfig
  columnKeys: string[]
  onChange: (config: RowFilterConfig) => void
}

const OPERATOR_OPTIONS: Array<{ value: RowFilterOperator; label: string }> = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'in', label: 'in' },
  { value: 'notIn', label: 'not in' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'not contains' },
  { value: 'empty', label: 'empty' },
  { value: 'notEmpty', label: 'not empty' },
  { value: 'regex', label: 'regex' },
  { value: 'notRegex', label: 'not regex' },
]

function newRule(columnKeys: string[]): RowFilterRule {
  return { type: 'rule', column: columnKeys[0] ?? '$row', operator: 'eq', value: '' }
}

function newGroup(columnKeys: string[]): RowFilterGroup {
  return { type: 'all', conditions: [newRule(columnKeys)] }
}

function normalizeOperator(rule: RowFilterRule, operator: RowFilterOperator): RowFilterRule {
  if (operator === 'in' || operator === 'notIn') {
    return { type: 'rule', column: rule.column, operator, values: rule.values ?? (rule.value ? [rule.value] : []) }
  }
  if (operator === 'empty' || operator === 'notEmpty') return { type: 'rule', column: rule.column, operator }
  return { type: 'rule', column: rule.column, operator, value: rule.value ?? rule.values?.join(', ') ?? '' }
}

export function countRowFilterRules(condition: RowFilterCondition | null | undefined): number {
  if (!condition) return 0
  return condition.type === 'rule' ? 1 : condition.conditions.reduce((count, child) => count + countRowFilterRules(child), 0)
}

function ConditionEditor({ condition, columnKeys, depth, onChange, onDelete }: {
  condition: RowFilterCondition
  columnKeys: string[]
  depth: number
  onChange: (condition: RowFilterCondition) => void
  onDelete: () => void
}) {
  if (condition.type === 'rule') {
    const usesValues = condition.operator === 'in' || condition.operator === 'notIn'
    const noValue = condition.operator === 'empty' || condition.operator === 'notEmpty'
    return (
      <div className="row-filter-rule">
        <Select size="small" value={condition.column} className="row-filter-column"
          onChange={column => onChange({ ...condition, column })}
          options={[{ value: '$row', label: '$row (index)' }, ...columnKeys.map(key => ({ value: key, label: key }))]} />
        <Select size="small" value={condition.operator} className="row-filter-operator"
          popupMatchSelectWidth={140}
          onChange={operator => onChange(normalizeOperator(condition, operator))}
          options={OPERATOR_OPTIONS} />
        {usesValues ? (
          <Select size="small" mode="tags" value={condition.values ?? []} className="row-filter-value"
            tokenSeparators={[',']} onChange={values => onChange({ ...condition, values })} />
        ) : !noValue ? (
          <Input size="small" value={condition.value ?? ''} className="row-filter-value" placeholder="value"
            onChange={event => onChange({ ...condition, value: event.target.value })} />
        ) : <span className="row-filter-value" />}
        <Button size="small" type="text" danger aria-label="Delete row condition" icon={<DeleteOutlined />} onClick={onDelete} />
      </div>
    )
  }

  return (
    <div className={`row-filter-group depth-${Math.min(depth, 3)}`}>
      <div className="row-filter-group-heading">
        <Segmented size="small" value={condition.type} options={[{ value: 'all', label: 'All' }, { value: 'any', label: 'Any' }]}
          onChange={type => onChange({ ...condition, type: type as 'all' | 'any' })} />
        <Tooltip title="Add condition"><Button size="small" type="text" aria-label="Add row condition" icon={<PlusOutlined />}
          onClick={() => onChange({ ...condition, conditions: [...condition.conditions, newRule(columnKeys)] })} /></Tooltip>
        <Tooltip title={depth >= MAX_ROW_FILTER_DEPTH - 1 ? 'Maximum nesting reached' : 'Add group'}><Button size="small" type="text"
          disabled={depth >= MAX_ROW_FILTER_DEPTH - 1} aria-label="Add row condition group" icon={<FolderAddOutlined />}
          onClick={() => onChange({ ...condition, conditions: [...condition.conditions, newGroup(columnKeys)] })} /></Tooltip>
        {depth > 0 && <Button size="small" type="text" danger aria-label="Delete row condition group" icon={<DeleteOutlined />} onClick={onDelete} />}
      </div>
      <div className="row-filter-group-body">
        {condition.conditions.map((child, index) => (
          <ConditionEditor key={index} condition={child} columnKeys={columnKeys} depth={depth + 1}
            onChange={updated => onChange({ ...condition, conditions: condition.conditions.map((item, itemIndex) => itemIndex === index ? updated : item) })}
            onDelete={() => {
              const remaining = condition.conditions.filter((_, itemIndex) => itemIndex !== index)
              if (remaining.length) onChange({ ...condition, conditions: remaining })
              else onDelete()
            }} />
        ))}
      </div>
    </div>
  )
}

export function RowFilterEditor({ config: configured, columnKeys, onChange }: RowFilterEditorProps) {
  const config = configured ?? DEFAULT_ROW_FILTER
  const condition = config.condition
  return (
    <div className="row-filter-editor">
      <div className="row-filter-checkbox">
        <Checkbox aria-label="Remove empty rows" checked={config.removeEmptyRows}
          onChange={event => onChange({ ...config, removeEmptyRows: event.target.checked })} />
        <span>Remove empty rows</span>
      </div>
      <div className="row-filter-checkbox">
        <Checkbox aria-label="Treat fully struck-through cells as empty" checked={config.emptyCellConditions.fullyStruck} disabled={!config.removeEmptyRows}
          onChange={event => onChange({
            ...config,
            emptyCellConditions: { ...config.emptyCellConditions, fullyStruck: event.target.checked },
          })} />
        <span>Treat fully struck-through cells as empty</span>
      </div>
      {condition ? (
        <ConditionEditor condition={condition.type === 'rule' ? { type: 'all', conditions: [condition] } : condition}
          columnKeys={columnKeys} depth={0} onChange={next => onChange({ ...config, condition: next })}
          onDelete={() => onChange({ ...config, condition: null })} />
      ) : (
        <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => onChange({ ...config, condition: newGroup(columnKeys) })}>
          Add condition
        </Button>
      )}
      {condition && (
        <Popconfirm title="Clear all row filter conditions?" okText="Clear" cancelText="Cancel"
          onConfirm={() => onChange({ ...config, condition: null })}>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} className="row-filter-clear-button">Clear conditions</Button>
        </Popconfirm>
      )}
    </div>
  )
}
