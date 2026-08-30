import { Button, Checkbox, Input, Popconfirm, Segmented, Select, Tooltip } from 'antd'
import { DeleteOutlined, FolderAddOutlined, PlusOutlined } from '@ant-design/icons'
import type { RowFilterCondition, RowFilterConfig, RowFilterGroup, RowFilterOperator, RowFilterRule } from '../types'
import { DEFAULT_ROW_FILTER, MAX_ROW_FILTER_DEPTH } from '../services/rowFilter'
import { useI18n } from '../i18n'

interface RowFilterEditorProps {
  config?: RowFilterConfig
  columnKeys: string[]
  onChange: (config: RowFilterConfig) => void
}

function operatorOptions(t: (key: string) => string): Array<{ value: RowFilterOperator; label: string }> {
  return [
    { value: 'eq', label: t('filter.eq') }, { value: 'neq', label: t('filter.neq') },
    { value: 'in', label: t('filter.in') }, { value: 'notIn', label: t('filter.notIn') },
    { value: 'contains', label: t('filter.contains') }, { value: 'notContains', label: t('filter.notContains') },
    { value: 'empty', label: t('filter.empty') }, { value: 'notEmpty', label: t('filter.notEmpty') },
    { value: 'regex', label: t('filter.regex') }, { value: 'notRegex', label: t('filter.notRegex') },
  ]
}

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
  const { t } = useI18n()
  if (condition.type === 'rule') {
    const usesValues = condition.operator === 'in' || condition.operator === 'notIn'
    const noValue = condition.operator === 'empty' || condition.operator === 'notEmpty'
    return (
      <div className="row-filter-rule">
        <Select size="small" value={condition.column} className="row-filter-column"
          onChange={column => onChange({ ...condition, column })}
          options={[{ value: '$row', label: t('filter.rowIndex') }, ...columnKeys.map(key => ({ value: key, label: key }))]} />
        <Select size="small" value={condition.operator} className="row-filter-operator"
          popupMatchSelectWidth={140}
          onChange={operator => onChange(normalizeOperator(condition, operator))}
          options={operatorOptions(t)} />
        {usesValues ? (
          <Select size="small" mode="tags" value={condition.values ?? []} className="row-filter-value"
            tokenSeparators={[',']} onChange={values => onChange({ ...condition, values })} />
        ) : !noValue ? (
          <Input size="small" value={condition.value ?? ''} className="row-filter-value" placeholder={t('filter.value')}
            onChange={event => onChange({ ...condition, value: event.target.value })} />
        ) : <span className="row-filter-value" />}
        <Button size="small" type="text" danger aria-label={t('filter.deleteCondition')} icon={<DeleteOutlined />} onClick={onDelete} />
      </div>
    )
  }

  return (
    <div className={`row-filter-group depth-${Math.min(depth, 3)}`}>
      <div className="row-filter-group-heading">
        <Segmented size="small" value={condition.type} options={[{ value: 'all', label: t('common.all') }, { value: 'any', label: t('common.any') }]}
          onChange={type => onChange({ ...condition, type: type as 'all' | 'any' })} />
        <Tooltip title={t('filter.add')}><Button size="small" type="text" aria-label={t('filter.add')} icon={<PlusOutlined />}
          onClick={() => onChange({ ...condition, conditions: [...condition.conditions, newRule(columnKeys)] })} /></Tooltip>
        <Tooltip title={depth >= MAX_ROW_FILTER_DEPTH - 1 ? t('filter.maxDepth') : t('filter.addGroup')}><Button size="small" type="text"
          disabled={depth >= MAX_ROW_FILTER_DEPTH - 1} aria-label={t('filter.addGroup')} icon={<FolderAddOutlined />}
          onClick={() => onChange({ ...condition, conditions: [...condition.conditions, newGroup(columnKeys)] })} /></Tooltip>
        {depth > 0 && <Button size="small" type="text" danger aria-label={t('filter.deleteGroup')} icon={<DeleteOutlined />} onClick={onDelete} />}
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
  const { t } = useI18n()
  const config = configured ?? DEFAULT_ROW_FILTER
  const condition = config.condition
  return (
    <div className="row-filter-editor">
      <div className="row-filter-checkbox">
        <Checkbox aria-label={t('filter.removeEmpty')} checked={config.removeEmptyRows}
          onChange={event => onChange({ ...config, removeEmptyRows: event.target.checked })} />
        <span>{t('filter.removeEmpty')}</span>
      </div>
      <div className="row-filter-match-mode">
        <span>{t('filter.matchingRows')}</span>
        <Segmented size="small" value={config.matchMode ?? 'include'} options={[
          { value: 'include', label: t('filter.includeMatches') },
          { value: 'exclude', label: t('filter.excludeMatches') },
        ]} onChange={matchMode => onChange({ ...config, matchMode: matchMode as 'include' | 'exclude' })} />
      </div>
      <div className="row-filter-checkbox">
        <Checkbox aria-label={t('filter.struckEmpty')} checked={config.emptyCellConditions.fullyStruck} disabled={!config.removeEmptyRows}
          onChange={event => onChange({
            ...config,
            emptyCellConditions: { ...config.emptyCellConditions, fullyStruck: event.target.checked },
          })} />
        <span>{t('filter.struckEmpty')}</span>
      </div>
      {condition ? (
        <ConditionEditor condition={condition.type === 'rule' ? { type: 'all', conditions: [condition] } : condition}
          columnKeys={columnKeys} depth={0} onChange={next => onChange({ ...config, condition: next })}
          onDelete={() => onChange({ ...config, condition: null })} />
      ) : (
        <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => onChange({ ...config, condition: newGroup(columnKeys) })}>
          {t('filter.add')}
        </Button>
      )}
      {condition && (
        <Popconfirm title={t('filter.clearConfirm')} okText={t('filter.clear')} cancelText={t('common.cancel')}
          onConfirm={() => onChange({ ...config, condition: null })}>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} className="row-filter-clear-button">{t('filter.clear')}</Button>
        </Popconfirm>
      )}
    </div>
  )
}
