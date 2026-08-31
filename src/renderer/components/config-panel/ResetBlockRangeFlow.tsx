import { useEffect, useMemo, useState } from 'react'
import { Button, message, Select, Typography } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import type { BlockConfig, CellRange, WorkbookConfig } from '../../types'
import type { SpreadsheetCapability } from '../../services/spreadsheetCapability'
import { useI18n } from '../../i18n'
import type { BlockRangeSource } from '../../features/extraction/rangeReset'

interface ResetBlockRangeFlowProps {
  block: BlockConfig
  workbooks: WorkbookConfig[]
  loadedWorkbookId: string | null
  spreadsheet: SpreadsheetCapability
  onApply: (source: BlockRangeSource) => void
  onClose: () => void
  onReselectRange?: (onRange: (range: CellRange) => void) => void
  onActivateWorkbook: (workbookId: string, sheetName?: string) => void
}

function describeRange(workbookName: string, sheetName: string | null, range: CellRange | null): string {
  return [workbookName, sheetName, range?.a1Notation].filter(Boolean).join(' · ')
}

export function ResetBlockRangeFlow({
  block, workbooks, loadedWorkbookId, spreadsheet, onApply, onClose, onReselectRange, onActivateWorkbook,
}: ResetBlockRangeFlowProps) {
  const { t } = useI18n()
  const [workbookId, setWorkbookId] = useState(block.workbookId || loadedWorkbookId || '')
  const [sheetName, setSheetName] = useState(block.activeSheet || '')
  const [range, setRange] = useState<CellRange | null>(block.range)
  const [showReview, setShowReview] = useState(false)

  const currentWorkbook = useMemo(() => workbooks.find(item => item.id === block.workbookId), [block.workbookId, workbooks])
  const selectedWorkbook = useMemo(() => workbooks.find(item => item.id === workbookId), [workbookId, workbooks])
  const targetIsLoaded = workbookId !== '' && workbookId === loadedWorkbookId
  const availableSheets = targetIsLoaded ? spreadsheet.sheetNames() : []

  useEffect(() => {
    if (!targetIsLoaded || !sheetName || availableSheets.includes(sheetName)) return
    setSheetName(availableSheets[0] || '')
  }, [availableSheets, sheetName, targetIsLoaded])

  const selectWorkbook = (nextWorkbookId: string) => {
    setWorkbookId(nextWorkbookId)
    setRange(null)
    const nextWorkbook = workbooks.find(item => item.id === nextWorkbookId)
    const nextSheet = nextWorkbook?.activeSheetName || ''
    setSheetName(nextSheet)
    setShowReview(false)
    onActivateWorkbook(nextWorkbookId, nextSheet || undefined)
  }

  const selectSheet = (nextSheetName: string) => {
    setSheetName(nextSheetName)
    setRange(null)
    setShowReview(false)
    if (workbookId) onActivateWorkbook(workbookId, nextSheetName)
  }

  const reselectRange = () => {
    onReselectRange?.(nextRange => {
      setRange(nextRange)
      setShowReview(false)
    })
  }

  const cancel = () => {
    if (block.workbookId) onActivateWorkbook(block.workbookId, block.activeSheet ?? undefined)
    onClose()
  }

  const oldDescription = describeRange(currentWorkbook?.name || t('project.thisWorkbook'), block.activeSheet, block.range)
  const newDescription = describeRange(selectedWorkbook?.name || t('project.thisWorkbook'), sheetName, range)
  const canReview = Boolean(workbookId && sheetName && range)

  return (
    <div className="block-range-reset-flow">
      <div className="block-range-reset-summary">
        <Typography.Text type="secondary">{t('block.resetCurrent')}</Typography.Text>
        <Typography.Text className="block-range-reset-value">{oldDescription || '—'}</Typography.Text>
      </div>
      <div className="block-range-reset-fields">
        <label>
          <span>{t('block.resetWorkbook')}</span>
          <Select value={workbookId || undefined} onChange={selectWorkbook} options={workbooks.map(item => ({ value: item.id, label: item.name }))} />
        </label>
        <label>
          <span>{t('block.resetSheet')}</span>
          <Select value={sheetName || undefined} onChange={selectSheet} disabled={!targetIsLoaded} options={availableSheets.map(name => ({ value: name, label: name }))} />
        </label>
        {!targetIsLoaded && <Typography.Text type="secondary">{t('block.resetLoadWorkbook')}</Typography.Text>}
        <div className="block-range-reset-range">
          <span>{t('block.resetRangeField')}</span>
          <Typography.Text className="block-range-reset-value">{range?.a1Notation || t('common.noRange')}</Typography.Text>
          <Button size="small" onClick={reselectRange} disabled={!targetIsLoaded}>{t('reconcile.reselect')}</Button>
        </div>
      </div>
      {showReview && (
        <div className="block-range-reset-review">
          <Typography.Text>{t('block.resetReview')}</Typography.Text>
          <div><span>{t('block.resetBefore')}</span><strong>{oldDescription || '—'}</strong></div>
          <div><span>{t('block.resetAfter')}</span><strong>{newDescription || '—'}</strong></div>
          <Typography.Text type="secondary">{t('block.resetPreserveConfig')}</Typography.Text>
        </div>
      )}
      <div className="block-range-reset-actions">
        {!showReview ? <Button type="primary" size="small" onClick={() => setShowReview(true)} disabled={!canReview}>{t('block.resetReviewAction')}</Button> : <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => { onApply({ workbookId, activeSheet: sheetName, range }); message.success(t('block.resetSuccess')) }}>{t('block.resetApply')}</Button>}
        <Button size="small" onClick={cancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  )
}
