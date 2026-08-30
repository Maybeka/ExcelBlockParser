import { Button, Select } from 'antd'
import { LockOutlined, PlusOutlined, PlayCircleOutlined, UnlockOutlined } from '@ant-design/icons'
import type { WorkspaceFeaturePanelContext } from '../panel/workspacePanel'
import { createDefaultBlock } from './model'
import { createDefaultRegion } from '../regions/model'
import { useI18n } from '../../i18n'

export function ExtractionHeaderActions({ context }: { context: WorkspaceFeaturePanelContext }) {
  const { t } = useI18n()
  const { project } = context
  const value = project.activeRegionId ? `region:${project.activeRegionId}` : `block:${project.activeBlockId}`
  const selectItem = (value: string) => {
    const [kind, id] = value.split(':')
    const item = kind === 'region' ? project.regions.find(region => region.id === id) : project.blocks.find(block => block.id === id)
    if (!item) return
    if (item.workbookId && item.workbookId !== context.loadedWorkbookId) context.activateWorkbook(item.workbookId, item.activeSheet ?? undefined)
    else if (item.activeSheet) context.spreadsheet.setActiveSheet(item.activeSheet)
    context.focusRange(item.workbookId, item.activeSheet, item.range)
    context.selectProject(current => kind === 'region'
      ? { ...current, activeRegionId: id, activeBlockId: '' }
      : { ...current, activeBlockId: id, activeRegionId: null })
  }
  const addBlock = () => context.transactProject(current => {
    const max = current.blocks.reduce((value, block) => Math.max(value, Number(block.label.match(/^block_(\d+)$/)?.[1] ?? 0)), 0)
    const block = createDefaultBlock(max, current.activeWorkbookId)
    return { ...current, blocks: [...current.blocks, block], activeBlockId: block.id, activeRegionId: null }
  })
  const addRegion = () => context.transactProject(current => {
    const region = createDefaultRegion(current, current.activeWorkbookId)
    return { ...current, regions: [...current.regions, region], activeRegionId: region.id, activeBlockId: '' }
  })
  const ready = project.blocks.some(block => block.range) || project.regions.some(region => region.range)
  const canAddExtraction = Boolean(project.activeWorkbookId)
  const optionLabel = (label: string, locked: boolean) => (
    <span className="extraction-item-option">
      {locked ? <LockOutlined className="is-locked" aria-label={t('common.locked')} /> : <UnlockOutlined className="is-unlocked" aria-label={t('common.unlocked')} />}
      <span>{label}</span>
    </span>
  )
  return <>
    <Select aria-label={t('extract.select')} className="extraction-item-selector" size="small" value={value} onChange={selectItem}
      options={[
        { label: t('workspace.blocks'), options: project.blocks.map(block => ({ value: `block:${block.id}`, label: optionLabel(block.label || block.id, block.selectionLocked) })) },
        { label: t('workspace.regions'), options: project.regions.map(region => ({ value: `region:${region.id}`, label: optionLabel(region.label || region.id, region.selectionLocked) })) },
      ]} />
    <Button aria-keyshortcuts="Control+Enter Meta+Enter" aria-label={t('common.preview')} size="small" icon={<PlayCircleOutlined />} loading={context.running} disabled={!ready || context.running} onClick={context.run} />
    <Button className="extraction-add-button" aria-label={t('extract.addBlock')} size="small" icon={<PlusOutlined />} disabled={context.running || !canAddExtraction} onClick={addBlock}>{t('workspace.blocks')}</Button>
    <Button className="extraction-add-button" aria-label={t('extract.addRegion')} size="small" icon={<PlusOutlined />} disabled={context.running || !canAddExtraction} onClick={addRegion}>{t('workspace.regions')}</Button>
  </>
}
