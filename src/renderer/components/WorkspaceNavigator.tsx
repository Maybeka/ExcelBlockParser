import { Button, Divider, Empty, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, FileExcelOutlined, FolderOpenOutlined, LockOutlined, TableOutlined, UnlockOutlined } from '@ant-design/icons'
import type { BlockConfig, RegionConfig } from '../types'

interface WorkspaceNavigatorProps {
  fileName: string | null
  sheetNames: string[]
  activeSheet: string | null
  blocks: BlockConfig[]
  regions: RegionConfig[]
  activeBlockId: string
  activeRegionId: string | null
  onOpen: () => void
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

export function WorkspaceNavigator({ fileName, sheetNames, activeSheet, blocks, regions, activeBlockId, activeRegionId, onOpen, onSelectSheet, onSelectBlock, onSelectRegion, onMoveBlock, onMoveRegion }: WorkspaceNavigatorProps) {
  return <nav aria-label="Workspace navigator" style={{ height: '100%', overflow: 'auto', padding: 12, background: '#fcfcfd' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <FileExcelOutlined style={{ color: '#107c41', fontSize: 18 }} />
      <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={fileName ?? undefined}>{fileName ?? 'No workbook open'}</span>
      <Tooltip title="Open workbook"><Button aria-label="Open workbook" size="small" type="text" icon={<FolderOpenOutlined />} onClick={onOpen} /></Tooltip>
    </div>

    <Divider style={{ margin: '12px 0 8px' }} />
    <div className="workspace-section-title">Sheets</div>
    {sheetNames.length === 0 ? <div className="workspace-empty">Open a workbook to see its sheets.</div> : sheetNames.map(sheet => (
      <button key={sheet} type="button" className={`workspace-item ${sheet === activeSheet ? 'is-active' : ''}`} onClick={() => onSelectSheet(sheet)}>
        <TableOutlined /><span>{sheet}</span>
      </button>
    ))}

    <Divider style={{ margin: '14px 0 8px' }} />
    <div className="workspace-section-title">Extractors <span>{blocks.length}</span></div>
    {blocks.map((block, index) => (
      <div key={block.id} className={`workspace-row ${block.id === activeBlockId ? 'is-active' : ''}`} onClick={() => onSelectBlock(block.id)}>
        <button type="button" className="workspace-item workspace-item-main" onClick={() => onSelectBlock(block.id)}>
          {block.selectionLocked ? <LockOutlined /> : <UnlockOutlined />}
          <span title={block.label}>{block.label || `block_${index + 1}`}</span>
          {block.range && <small>{block.range.a1Notation}</small>}
        </button>
        <ListControls canUp={index > 0} canDown={index < blocks.length - 1} onMoveUp={() => onMoveBlock(block.id, -1)} onMoveDown={() => onMoveBlock(block.id, 1)} />
      </div>
    ))}

    <Divider style={{ margin: '14px 0 8px' }} />
    <div className="workspace-section-title">Regions <span>{regions.length}</span></div>
    {regions.length === 0 ? <div className="workspace-empty">No regions configured.</div> : regions.map((region, index) => (
      <div key={region.id} className={`workspace-row ${region.id === activeRegionId ? 'is-active' : ''}`} onClick={() => onSelectRegion(region.id)}>
        <button type="button" className="workspace-item workspace-item-main" onClick={() => onSelectRegion(region.id)}>
          {region.selectionLocked ? <LockOutlined /> : <UnlockOutlined />}
          <span title={region.label}>{region.label || `region_${index + 1}`}</span>
          {region.range && <small>{region.range.a1Notation}</small>}
        </button>
        <ListControls canUp={index > 0} canDown={index < regions.length - 1} onMoveUp={() => onMoveRegion(region.id, -1)} onMoveDown={() => onMoveRegion(region.id, 1)} />
      </div>
    ))}
    {!fileName && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ marginTop: 24 }} />}
  </nav>
}
