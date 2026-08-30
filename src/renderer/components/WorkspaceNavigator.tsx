import { useState } from 'react'
import { Button, Divider, Empty, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, CaretDownOutlined, CaretRightOutlined, FileExcelOutlined, FolderOutlined, LockOutlined, SettingOutlined, TableOutlined, UnlockOutlined } from '@ant-design/icons'
import type { ProjectWorkbook } from '../types'
import type { WorkspaceFeatureNavigationSection } from '../features/panel/workspacePanel'
import { useI18n } from '../i18n'

interface WorkspaceNavigatorProps {
  projectName: string
  fileName: string | null
  workbooks: ProjectWorkbook[]
  activeWorkbookId: string | null
  activeSheet: string | null
  featureSections: WorkspaceFeatureNavigationSection[]
  onOpen: () => void
  onSelectWorkbook: (id: string, sheetName?: string) => void
  onSelectSheet: (name: string) => void
}

function ListControls({ canUp, canDown, onMoveUp, onMoveDown }: { canUp: boolean; canDown: boolean; onMoveUp: () => void; onMoveDown: () => void }) {
  const { t } = useI18n()
  return <span style={{ display: 'inline-flex', opacity: 0 }} className="workspace-item-actions">
    <Tooltip title={t('common.moveUp')}><Button aria-label={t('common.moveUp')} size="small" type="text" icon={<ArrowUpOutlined />} disabled={!canUp} onClick={(event) => { event.stopPropagation(); onMoveUp() }} /></Tooltip>
    <Tooltip title={t('common.moveDown')}><Button aria-label={t('common.moveDown')} size="small" type="text" icon={<ArrowDownOutlined />} disabled={!canDown} onClick={(event) => { event.stopPropagation(); onMoveDown() }} /></Tooltip>
  </span>
}

export function WorkspaceNavigator({ projectName, fileName, workbooks, activeWorkbookId, activeSheet, featureSections, onOpen, onSelectWorkbook, onSelectSheet }: WorkspaceNavigatorProps) {
  const { t } = useI18n()
  const [workbooksExpanded, setWorkbooksExpanded] = useState(true)
  const [expandedWorkbookSheets, setExpandedWorkbookSheets] = useState<Record<string, boolean>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const sectionTitle = (label: string, count: number, expanded: boolean, onToggle: () => void) => (
    <button type="button" className="workspace-section-title" aria-label={label} aria-expanded={expanded} onClick={onToggle}>
      <span className="workspace-section-label">{expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}{label}</span>
      <span className="workspace-section-count">{count}</span>
    </button>
  )

  return <nav aria-label={t('workspace.navigation')} className="workspace-nav">
    <div className="workspace-file-heading">
      <span className="workspace-file-avatar workspace-project-avatar"><FolderOutlined /></span>
      <span className="workspace-file-copy">
        <span className="workspace-file-name" title={projectName}>{projectName}</span>
      </span>
      <Tooltip title={t('workspace.projectSettings')}><Button aria-label={t('workspace.projectSettings')} size="small" type="text" icon={<SettingOutlined />} onClick={onOpen} /></Tooltip>
    </div>

    {sectionTitle(t('workspace.workbooks'), workbooks.length, workbooksExpanded, () => setWorkbooksExpanded(expanded => !expanded))}
    {workbooksExpanded && workbooks.map(workbook => {
      const isActive = workbook.id === activeWorkbookId
      const workbookSheets = workbook.sheetNames ?? []
      const sheetsExpanded = expandedWorkbookSheets[workbook.id] ?? true
      return <div key={workbook.id} className="workspace-workbook-node">
        <div className={`workspace-workbook-heading ${isActive ? 'is-active' : ''}`}>
          <button type="button" className={`workspace-item ${isActive ? 'is-active' : ''}`} onClick={() => onSelectWorkbook(workbook.id)}>
            <span className="workspace-avatar workspace-file-avatar"><FileExcelOutlined /></span><span className="workspace-item-label" title={workbook.name}>{workbook.name}</span>
          </button>
          {workbookSheets.length > 0 && <Tooltip title={sheetsExpanded ? t('workspace.collapseSheets') : t('workspace.expandSheets')}>
            <Button size="small" type="text" className="workspace-workbook-toggle"
              aria-label={sheetsExpanded ? t('workspace.collapseSheets') : t('workspace.expandSheets')} aria-expanded={sheetsExpanded}
              icon={sheetsExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
              onClick={() => setExpandedWorkbookSheets(current => ({ ...current, [workbook.id]: !sheetsExpanded }))} />
          </Tooltip>}
        </div>
        {sheetsExpanded && workbookSheets.length > 0 && <div className="workspace-workbook-sheets" aria-label={t('workspace.sheetsOf', { name: workbook.name })}>
          {workbookSheets.map(sheet => (
            <button key={sheet} type="button" className={`workspace-item workspace-sheet-item ${isActive && sheet === activeSheet ? 'is-active' : ''}`} onClick={() => {
              if (isActive) onSelectSheet(sheet)
              else onSelectWorkbook(workbook.id, sheet)
            }}>
              <span className="workspace-sheet-tab-color" style={{ backgroundColor: workbook.sheetTabColors?.[sheet] }} aria-hidden="true" />
              <span className="workspace-avatar workspace-sheet-avatar"><TableOutlined /></span><span className="workspace-item-label" title={sheet}>{sheet}</span>
            </button>
          ))}
        </div>}
      </div>
    })}
    {workbooksExpanded && workbooks.length === 0 && <div className="workspace-empty">{t('workspace.noWorkbooks')}</div>}

    {featureSections.map(section => {
      const expanded = expandedSections[section.id] ?? true
      return <div key={section.id} className="workspace-feature-section">
        <Divider style={{ margin: '14px 0 8px' }} />
        {sectionTitle(section.label, section.items.length, expanded, () => setExpandedSections(current => ({ ...current, [section.id]: !expanded })))}
        {expanded && (section.items.length === 0 ? <div className="workspace-empty">{section.emptyText}</div> : section.items.map((item, index) => (
          <div key={item.id} className={`workspace-row ${item.active ? 'is-active' : ''}`}>
            <button type="button" className="workspace-item workspace-item-main" onClick={item.select}>
              <span className={`workspace-avatar ${item.avatarClassName ?? ''}`}>{item.locked ? <LockOutlined /> : <UnlockOutlined />}</span>
              <span className="workspace-item-copy">
                <span className="workspace-item-label" title={item.label}>{item.label}</span>
                {item.detail && <small title={item.detail}>{item.detail}</small>}
              </span>
            </button>
            <ListControls canUp={index > 0} canDown={index < section.items.length - 1} onMoveUp={() => item.move(-1)} onMoveDown={() => item.move(1)} />
          </div>
        )))}
      </div>
    })}
    {!fileName && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ marginTop: 24 }} />}
  </nav>
}
