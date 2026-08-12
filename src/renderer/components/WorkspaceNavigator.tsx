import { useState } from 'react'
import { Button, Divider, Empty, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, CaretDownOutlined, CaretRightOutlined, FileExcelOutlined, FolderOpenOutlined, FolderOutlined, LockOutlined, PlusOutlined, TableOutlined, UnlockOutlined } from '@ant-design/icons'
import type { ProjectWorkbook } from '../types'
import type { WorkspaceFeatureNavigationSection } from '../features/panel/workspacePanel'

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
  return <span style={{ display: 'inline-flex', opacity: 0 }} className="workspace-item-actions">
    <Tooltip title="Move up"><Button aria-label="Move up" size="small" type="text" icon={<ArrowUpOutlined />} disabled={!canUp} onClick={(event) => { event.stopPropagation(); onMoveUp() }} /></Tooltip>
    <Tooltip title="Move down"><Button aria-label="Move down" size="small" type="text" icon={<ArrowDownOutlined />} disabled={!canDown} onClick={(event) => { event.stopPropagation(); onMoveDown() }} /></Tooltip>
  </span>
}

export function WorkspaceNavigator({ projectName, fileName, workbooks, activeWorkbookId, activeSheet, featureSections, onOpen, onSelectWorkbook, onSelectSheet }: WorkspaceNavigatorProps) {
  const [workbooksExpanded, setWorkbooksExpanded] = useState(true)
  const [expandedWorkbookSheets, setExpandedWorkbookSheets] = useState<Record<string, boolean>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const sectionTitle = (label: string, count: number, expanded: boolean, onToggle: () => void) => (
    <button type="button" className="workspace-section-title" aria-label={label} aria-expanded={expanded} onClick={onToggle}>
      <span className="workspace-section-label">{expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}{label}</span>
      <span className="workspace-section-count">{count}</span>
    </button>
  )

  return <nav aria-label="Workspace navigator" className="workspace-nav">
    <div className="workspace-file-heading">
      <span className="workspace-file-avatar workspace-project-avatar"><FolderOutlined /></span>
      <span className="workspace-file-copy">
        <span className="workspace-file-name" title={projectName}>{projectName}</span>
      </span>
      <span className="workspace-project-count">{workbooks.length}</span>
      <Tooltip title="Project settings"><Button aria-label="Open project settings" size="small" type="text" icon={<FolderOpenOutlined />} onClick={onOpen} /></Tooltip>
    </div>

    {sectionTitle('Workbooks', workbooks.length, workbooksExpanded, () => setWorkbooksExpanded(expanded => !expanded))}
    {workbooksExpanded && workbooks.map(workbook => {
      const isActive = workbook.id === activeWorkbookId
      const workbookSheets = workbook.sheetNames ?? []
      const sheetsExpanded = expandedWorkbookSheets[workbook.id] ?? true
      return <div key={workbook.id} className="workspace-workbook-node">
        <div className={`workspace-workbook-heading ${isActive ? 'is-active' : ''}`}>
          <button type="button" className={`workspace-item ${isActive ? 'is-active' : ''}`} onClick={() => onSelectWorkbook(workbook.id)}>
            <span className="workspace-avatar workspace-file-avatar"><FileExcelOutlined /></span><span title={workbook.name}>{workbook.name}</span>
          </button>
          {workbookSheets.length > 0 && <Tooltip title={sheetsExpanded ? 'Collapse sheets' : 'Expand sheets'}>
            <Button size="small" type="text" className="workspace-workbook-toggle"
              aria-label={`${sheetsExpanded ? 'Collapse' : 'Expand'} ${workbook.name} sheets`} aria-expanded={sheetsExpanded}
              icon={sheetsExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
              onClick={() => setExpandedWorkbookSheets(current => ({ ...current, [workbook.id]: !sheetsExpanded }))} />
          </Tooltip>}
        </div>
        {sheetsExpanded && workbookSheets.length > 0 && <div className="workspace-workbook-sheets" aria-label={`${workbook.name} sheets`}>
          {workbookSheets.map(sheet => (
            <button key={sheet} type="button" className={`workspace-item workspace-sheet-item ${isActive && sheet === activeSheet ? 'is-active' : ''}`} onClick={() => {
              if (isActive) onSelectSheet(sheet)
              else onSelectWorkbook(workbook.id, sheet)
            }}>
              <span className="workspace-avatar workspace-sheet-avatar"><TableOutlined /></span><span>{sheet}</span>
            </button>
          ))}
        </div>}
      </div>
    })}
    {workbooksExpanded && workbooks.length === 0 && <div className="workspace-empty">Open workbooks whenever you need them.</div>}

    {featureSections.map(section => {
      const expanded = expandedSections[section.id] ?? true
      return <div key={section.id} className="workspace-feature-section">
        <Divider style={{ margin: '14px 0 8px' }} />
        {sectionTitle(section.label, section.items.length, expanded, () => setExpandedSections(current => ({ ...current, [section.id]: !expanded })))}
        {expanded && (section.items.length === 0 ? <div className="workspace-empty">{section.emptyText}</div> : section.items.map((item, index) => (
          <div key={item.id} className={`workspace-row ${item.active ? 'is-active' : ''}`}>
            <button type="button" className="workspace-item workspace-item-main" onClick={item.select}>
              <span className={`workspace-avatar ${item.avatarClassName ?? ''}`}>{item.locked ? <LockOutlined /> : <UnlockOutlined />}</span>
              <span title={item.label}>{item.label}</span>
              {item.detail && <small>{item.detail}</small>}
            </button>
            <ListControls canUp={index > 0} canDown={index < section.items.length - 1} onMoveUp={() => item.move(-1)} onMoveDown={() => item.move(1)} />
          </div>
        )))}
        {expanded && section.addAction && (
          <Button className="workspace-section-add" size="small" type="text" icon={<PlusOutlined />} onClick={section.addAction.run}>
            {section.addAction.label}
          </Button>
        )}
      </div>
    })}
    {!fileName && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ marginTop: 24 }} />}
  </nav>
}
