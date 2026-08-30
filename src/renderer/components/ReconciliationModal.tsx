import { useState, useEffect, type ReactNode } from 'react'
import { Badge, Tag, List, Typography, Space, Button, Empty, Select } from 'antd'
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  DownOutlined,
  RightOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import type { ReconciliationReport, BlockConfig, CellRange, ColumnMapping } from '../types'
import { useI18n } from '../i18n'

const { Text } = Typography

export interface ReconciliationModalProps {
  reports: ReconciliationReport[]
  blocks: BlockConfig[]
  availableSheets: string[]
  onApply: (fixedBlocks: BlockConfig[]) => void
  onCancel: () => void
  onBlockSelect?: (blockId: string) => void
  onApplyColumns?: (blockId: string, columns: ColumnMapping[]) => void
  onReselectRange?: () => void
}

interface StepDef {
  stepNumber: number
  title: string
  issues: ReconciliationReport['issues']
  fixes: ReconciliationReport['suggestedFixes']
}

function buildSteps(report: ReconciliationReport, t: (key: string) => string): StepDef[] {
  return [
    {
      stepNumber: 1,
      title: t('reconcile.sheet'),
      issues: report.issues.filter(i => i.type === 'sheet-missing'),
      fixes: report.suggestedFixes.filter(f => f.type === 'sheet-remap'),
    },
    {
      stepNumber: 2,
      title: t('reconcile.rangeContent'),
      issues: report.issues.filter(i =>
        ['row-shifted', 'content-changed'].includes(i.type),
      ),
      fixes: report.suggestedFixes.filter(f =>
        ['row-adjust', 'range-reselect', 'content-update'].includes(f.type),
      ),
    },
    {
      stepNumber: 3,
      title: t('reconcile.columns'),
      issues: report.issues.filter(i =>
        ['column-added', 'column-removed', 'column-shifted'].includes(i.type),
      ),
      fixes: report.suggestedFixes.filter(f =>
        ['column-remap', 'column-remove', 'column-reorder'].includes(f.type),
      ),
    },
  ]
}

function getStepStatus(
  issues: ReconciliationReport['issues'],
): 'success' | 'warning' | 'error' {
  if (issues.length === 0) return 'success'
  if (issues.some(i => i.severity === 'error')) return 'error'
  return 'warning'
}

interface BlockFixesState {
  remappedSheet?: string
  rangeReselect: boolean
  columnReorder: boolean
}

function emptyBlockFixes(): BlockFixesState {
  return { rangeReselect: false, columnReorder: false }
}

interface StepPanelProps {
  step: StepDef
  expanded: boolean
  onToggle: () => void
  extra?: ReactNode
  noIssuesText: string
}

function StepPanel({ step, expanded, onToggle, extra, noIssuesText }: StepPanelProps) {
  const status = getStepStatus(step.issues)
  const statusColor =
    status === 'error' ? '#ff4d4f' : status === 'warning' ? '#faad14' : '#52c41a'
  const StatusIcon =
    status === 'error'
      ? CloseCircleOutlined
      : status === 'warning'
        ? WarningOutlined
        : CheckCircleOutlined

  return (
    <div
      style={{
        marginBottom: 12,
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: '12px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#fafafa',
          borderBottom: expanded ? '1px solid #f0f0f0' : 'none',
          userSelect: 'none',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f0')}
        onMouseLeave={e => (e.currentTarget.style.background = '#fafafa')}
      >
        <Text
          style={{
            fontSize: 15,
            fontWeight: 600,
            minWidth: 22,
            color: '#333',
          }}
        >
          {step.stepNumber}.
        </Text>
        <StatusIcon style={{ color: statusColor, fontSize: 16 }} />
        <Text strong style={{ flex: 1 }}>
          {step.title}
        </Text>
        {step.issues.length > 0 && (
          <Badge
            count={step.issues.length}
            style={{ backgroundColor: statusColor }}
            showZero={false}
          />
        )}
        {expanded ? (
          <DownOutlined style={{ color: '#999', fontSize: 12 }} />
        ) : (
          <RightOutlined style={{ color: '#999', fontSize: 12 }} />
        )}
      </div>
      {expanded && (
        <div style={{ padding: '12px 16px' }}>
          {step.issues.length === 0 ? (
            <Text type="secondary" style={{ display: 'block', marginBottom: extra ? 12 : 0 }}>
              {noIssuesText}
            </Text>
          ) : (
            <List
              size="small"
              split={false}
              dataSource={step.issues}
              renderItem={issue => {
                const SevIcon =
                  issue.severity === 'error'
                    ? CloseCircleOutlined
                    : issue.severity === 'warning'
                      ? WarningOutlined
                      : CheckCircleOutlined
                const sevColor =
                  issue.severity === 'error'
                    ? '#ff4d4f'
                    : issue.severity === 'warning'
                      ? '#faad14'
                      : '#52c41a'
                return (
                  <List.Item style={{ padding: '6px 0' }}>
                    <List.Item.Meta
                      avatar={
                        <SevIcon style={{ color: sevColor, fontSize: 14 }} />
                      }
                      title={
                        <Text style={{ fontSize: 13 }}>
                          {issue.type.replace(/-/g, ' ')}
                        </Text>
                      }
                      description={
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {issue.message}
                        </Text>
                      }
                    />
                  </List.Item>
                )
              }}
            />
          )}
          {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
        </div>
      )}
    </div>
  )
}

export function ReconciliationModal({
  reports,
  blocks,
  availableSheets,
  onApply,
  onCancel,
  onBlockSelect,
  onApplyColumns,
  onReselectRange,
}: ReconciliationModalProps) {
  const { t } = useI18n()
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [blockFixes, setBlockFixes] = useState<Record<string, BlockFixesState>>({})

  // Reset selection when reports change
  useEffect(() => {
    if (reports.length > 0) {
      setSelectedBlockId(reports[0].blockId)
    }
  }, [reports])

  // When selected block changes, compute default expanded steps
  const selectedReport = selectedBlockId
    ? reports.find(r => r.blockId === selectedBlockId)
    : null

  useEffect(() => {
    if (selectedReport) {
      const steps = buildSteps(selectedReport, t)
      const defaultExpanded = new Set(
        steps.filter(s => s.issues.length > 0).map(s => s.stepNumber),
      )
      setExpandedSteps(defaultExpanded)

      // Initialize blockFixes entry if missing
      setBlockFixes(prev => {
        if (prev[selectedReport.blockId]) return prev
        return { ...prev, [selectedReport.blockId]: emptyBlockFixes() }
      })
    }
  }, [selectedBlockId, reports, t])

  const toggleStep = (n: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  const currentFixes = selectedBlockId
    ? blockFixes[selectedBlockId] ?? emptyBlockFixes()
    : emptyBlockFixes()

  const steps = selectedReport ? buildSteps(selectedReport, t) : []

  const okCount = reports.filter(r => r.status === 'ok').length
  const mismatchCount = reports.filter(
    r => r.status === 'columns-mismatch' || r.status === 'rows-mismatch',
  ).length
  const errorCount = reports.filter(r => r.status === 'sheet-missing').length
  const contentChangedCount = reports.filter(r =>
    r.issues.some(i => i.type === 'content-changed'),
  ).length

  const applyBlockFix = (blockId: string, partial: Partial<BlockFixesState>) => {
    setBlockFixes(prev => ({
      ...prev,
      [blockId]: { ...emptyBlockFixes(), ...prev[blockId], ...partial },
    }))
  }

  const handleApplyAll = () => {
    const adjusted = blocks.map(block => {
      const fixes = blockFixes[block.id]
      if (!fixes || (!fixes.remappedSheet && !fixes.rangeReselect && !fixes.columnReorder)) {
        return block
      }

      const next = { ...block }
      const report = reports.find(r => r.blockId === block.id)

      // Step 1: Sheet remap
      if (fixes.remappedSheet) {
        next.activeSheet = fixes.remappedSheet
      }

      // Step 2: Range reselect
      if (fixes.rangeReselect && report) {
        const rangeFix = report.suggestedFixes.find(f => f.type === 'range-reselect')
        if (rangeFix) {
          const data = rangeFix.data as { newRange: CellRange; remappedColumns: ColumnMapping[] }
          if (data) {
            next.range = data.newRange
            next.columns = data.remappedColumns
          }
        }
      }

      // Step 3: Column reorder
      if (fixes.columnReorder && report) {
        const reorderFix = report.suggestedFixes.find(f => f.type === 'column-reorder')
        if (reorderFix) {
          const data = reorderFix.data as { remappedColumns: ColumnMapping[] }
          if (data) {
            next.columns = data.remappedColumns
          }
        }
      }

      return next
    })

    onApply(adjusted)
  }

  const isRangeReselectApplied = currentFixes.rangeReselect
  const isColumnReorderApplied = currentFixes.columnReorder

  const renderStep1Extra = (step: StepDef) => {
    const appliedSheet = currentFixes.remappedSheet

    if (appliedSheet) {
      return (
        <Space>
          <Tag icon={<CheckOutlined />} color="green">
            {t('reconcile.remappedTo', { sheet: appliedSheet })}
          </Tag>
        </Space>
      )
    }

    return (
      <Space style={{ width: '100%' }}>
        <Select
          style={{ width: 240 }}
          placeholder={step.issues.length === 0 ? t('reconcile.changeBoundSheet') : t('reconcile.selectSheet')}
          onChange={(val: string) => {
            if (selectedBlockId) {
              applyBlockFix(selectedBlockId, { remappedSheet: val })
            }
          }}
          options={availableSheets.map(s => ({ value: s, label: s }))}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {step.issues.length === 0
            ? t('reconcile.manualRemap')
            : t('reconcile.chooseMatch')}
        </Text>
      </Space>
    )
  }

  const renderStep2Extra = (step: StepDef) => {
    // Content change summary
    const contentIssues = step.issues.filter(i => i.type === 'content-changed')
    const contentSummary =
      contentIssues.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('reconcile.cellsChanged', { count: contentIssues.length, suffix: contentIssues.length !== 1 ? 's' : '' })}
          </Text>
        </div>
      ) : null

    if (isRangeReselectApplied) {
      return (
        <>
          {contentSummary}
          <Space>
            <Tag icon={<CheckOutlined />} color="green">
              {t('reconcile.rangeReselectApplied')}
            </Tag>
          </Space>
        </>
      )
    }

    return (
      <>
        {contentSummary}
        <Button
          size="small"
          icon={<CheckOutlined />}
          onClick={() => {
            onReselectRange?.()
            if (selectedBlockId) {
              applyBlockFix(selectedBlockId, { rangeReselect: true })
            }
          }}
        >
          {t('reconcile.reselect')}
        </Button>
      </>
    )
  }

  const renderStep3Extra = (step: StepDef) => {
    if (isColumnReorderApplied) {
      return (
        <Space>
          <Tag icon={<CheckOutlined />} color="green">
            {t('reconcile.columnReorderApplied')}
          </Tag>
        </Space>
      )
    }

    return (
      <Button
        size="small"
        icon={<CheckOutlined />}
        onClick={() => {
          if (selectedBlockId) {
            applyBlockFix(selectedBlockId, { columnReorder: true })
          }
        }}
      >
        {t('reconcile.reorderColumns')}
      </Button>
    )
  }

  const hasPendingFixes = Object.values(blockFixes).some(
    f => f.remappedSheet || f.rangeReselect || f.columnReorder,
  )

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Text strong style={{ fontSize: 15 }}>{t('reconcile.title')}</Text>
        <Button type="text" aria-label={t('common.close')} onClick={onCancel}>✕</Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {/* Summary tags */}
        <Space style={{ marginBottom: 16 }}>
          <Tag color="green">{okCount} {t('reconcile.statusOk')}</Tag>
          {mismatchCount > 0 && <Tag color="orange">{mismatchCount} {t('reconcile.needAttention')}</Tag>}
          {errorCount > 0 && <Tag color="red">{errorCount} {t('reconcile.errors')}</Tag>}
          {contentChangedCount > 0 && (
            <Tag color="orange">{contentChangedCount} {t('reconcile.statusContentChanged')}</Tag>
          )}
        </Space>

        {/* Block selector + detail */}
        <div style={{ display: 'flex', gap: 16, minHeight: 300 }}>
          {/* Left: block list */}
          <div
            style={{
              width: 240,
              borderRight: '1px solid #f0f0f0',
              overflowY: 'auto',
              maxHeight: 440,
            }}
          >
            <List
              dataSource={reports}
              renderItem={report => {
                const isSelected = selectedBlockId === report.blockId
                const hasBlockFixes =
                  blockFixes[report.blockId] &&
                  (blockFixes[report.blockId].remappedSheet ||
                    blockFixes[report.blockId].rangeReselect ||
                    blockFixes[report.blockId].columnReorder)
                return (
                  <List.Item
                    onClick={() => setSelectedBlockId(report.blockId)}
                    style={{
                      cursor: 'pointer',
                      padding: '8px 12px',
                      background: isSelected ? '#e6f4ff' : undefined,
                      borderLeft: isSelected
                        ? '3px solid #1677ff'
                        : '3px solid transparent',
                    }}
                  >
                    <Space>
                      <Badge
                        status={report.status === 'ok' ? 'success' : report.status === 'sheet-missing' ? 'error' : 'warning'}
                      />
                      <Text>{report.label}</Text>
                      {hasBlockFixes && <CheckOutlined style={{ color: '#52c41a', fontSize: 12 }} />}
                    </Space>
                  </List.Item>
                )
              }}
            />
          </div>

          {/* Right: 3-step flow */}
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 440, display: 'flex', flexDirection: 'column' }}>
            <Select style={{ width: '100%', marginBottom: 16 }} value={selectedBlockId || undefined} placeholder={t('reconcile.selectBlock')} onChange={(val) => { setSelectedBlockId(val); onBlockSelect?.(val) }} options={blocks.filter(b => b.range).map(b => ({ value: b.id, label: `${b.label} — ${b.activeSheet || t('reconcile.activeSheet')}!${b.range!.a1Notation}` }))} />
            {selectedReport ? (
              steps.length > 0 ? (
                steps.map(step => (
                  <StepPanel
                    key={step.stepNumber}
                    step={step}
                    expanded={expandedSteps.has(step.stepNumber)}
                    onToggle={() => toggleStep(step.stepNumber)}
                    extra={
                      step.stepNumber === 1
                        ? renderStep1Extra(step)
                        : step.stepNumber === 2
                          ? renderStep2Extra(step)
                          : renderStep3Extra(step)
                    }
                    noIssuesText={t('reconcile.noIssues')}
                  />
                ))
              ) : (
                <Empty description={t('reconcile.noData')} />
              )
            ) : (
              <Empty description={t('reconcile.selectDetails')} />
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 16,
            borderTop: '1px solid #f0f0f0',
            marginTop: 16,
          }}
        >
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type="primary" onClick={handleApplyAll} disabled={!hasPendingFixes}>
            {t('reconcile.applyAll')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ReconciliationModal
