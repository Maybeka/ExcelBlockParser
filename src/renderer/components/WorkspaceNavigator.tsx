import { useState } from 'react'
import { Button, Divider, Empty, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, CaretDownOutlined, CaretRightOutlined, FileExcelOutlined, FolderOpenOutlined, FolderOutlined, LockOutlined, TableOutlined, UnlockOutlined } from '@ant-design/icons'
import type { BlockConfig, ProjectWorkbook, RegionConfig } from '../types'

interface WorkspaceNavigatorProps {
  projectName: string
  fileName: string | null
  workbooks: ProjectWorkbook[]
  activeWorkbookId: string | null
  activeSheet: string | null
  blocks: BlockConfig[]
  regions: RegionConfig[]
  activeBlockId: string
  activeRegionId: string | null
  onOpen: () => void
  onSelectWorkbook: (id: string, sheetName?: string) => void
  onSelectSheet: (name: string) => void
  onSelectBlock: (id: string) => void
  onSelectRegion: (id: string) => void
  onMoveBlock: (id: string, direction: -1 | 1) => void
  onMoveRegion: (id: string, direction: -1 | 1) => void
}

function ListControls({ canUp, canDown, onMoveUp, onMoveDown }: { canUp: boolean; canDown: boolean; onMoveUp: () => void; onMoveDown: () => void }) {
  return <span style={{ display: 'inline-flex', opacity: 0 }} className="workspace-item-actions">
    <Tooltip title="Move up"><Button aria-label="Move up" size="small" type="text" icon={<ArrowUpOutlined />} disabled={!canUp} onClick={(event) => { event.stopPropagation(); onMoveUp() }} /></Tooltip>
    <Tooltip title="Move down"><Button aria-label="Move down" size="small" type="text" icon={<ArrowDownOutlined />} disabled={!canDown} onClick={(event) => { event.stopPropagation(); onMoveDown() }} /></Tooltip>
  </span>
}

export function WorkspaceNavigator({ projectName, fileName, workbooks, activeWorkbookId, activeSheet, blocks, regions, activeBlockId, activeRegionId, onOpen, onSelectWorkbook, onSelectSheet, onSelectBlock, onSelectRegion, onMoveBlock, onMoveRegion }: WorkspaceNavigatorProps) {
  const [workbooksExpanded, setWorkbooksExpanded] = useState(true)
  const [extractorsExpanded, setExtractorsExpanded] = useState(true)
  const [regionsExpanded, setRegionsExpanded] = useState(true)

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
      return <div key={workbook.id} className="workspace-workbook-node">
        <button type="button" className={`workspace-item ${isActive ? 'is-active' : ''}`} onClick={() => onSelectWorkbook(workbook.id)}>
          <span className="workspace-avatar workspace-file-avatar"><FileExcelOutlined /></span><span title={workbook.name}>{workbook.name}</span>
        </button>
        {workbookSheets.length > 0 && <div className="workspace-workbook-sheets" aria-label={`${workbook.name} sheets`}>
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

    <Divider style={{ margin: '14px 0 8px' }} />
    {sectionTitle('Extractors', blocks.length, extractorsExpanded, () => setExtractorsExpanded(expanded => !expanded))}
    {extractorsExpanded && blocks.map((block, index) => (
      <div key={block.id} className={`workspace-row ${block.id === activeBlockId ? 'is-active' : ''}`} onClick={() => onSelectBlock(block.id)}>
        <button type="button" className="workspace-item workspace-item-main" onClick={() => onSelectBlock(block.id)}>
          <span className="workspace-avatar workspace-block-avatar">{block.selectionLocked ? <LockOutlined /> : <UnlockOutlined />}</span>
          <span title={block.label}>{block.label || `block_${index + 1}`}</span>
          {block.range && <small>{block.range.a1Notation}</small>}
        </button>
        <ListControls canUp={index > 0} canDown={index < blocks.length - 1} onMoveUp={() => onMoveBlock(block.id, -1)} onMoveDown={() => onMoveBlock(block.id, 1)} />
      </div>
    ))}

    <Divider style={{ margin: '14px 0 8px' }} />
    {sectionTitle('Regions', regions.length, regionsExpanded, () => setRegionsExpanded(expanded => !expanded))}
    {regionsExpanded && (regions.length === 0 ? <div className="workspace-empty">No regions configured.</div> : regions.map((region, index) => (
      <div key={region.id} className={`workspace-row ${region.id === activeRegionId ? 'is-active' : ''}`} onClick={() => onSelectRegion(region.id)}>
        <button type="button" className="workspace-item workspace-item-main" onClick={() => onSelectRegion(region.id)}>
          <span className="workspace-avatar workspace-region-avatar">{region.selectionLocked ? <LockOutlined /> : <UnlockOutlined />}</span>
          <span title={region.label}>{region.label || `region_${index + 1}`}</span>
          {region.range && <small>{region.range.a1Notation}</small>}
        </button>
        <ListControls canUp={index > 0} canDown={index < regions.length - 1} onMoveUp={() => onMoveRegion(region.id, -1)} onMoveDown={() => onMoveRegion(region.id, 1)} />
      </div>
    )))}
    {!fileName && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ marginTop: 24 }} />}
  </nav>
}
