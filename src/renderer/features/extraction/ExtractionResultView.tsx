import { useState } from 'react'
import { PreviewWindow } from '../../components/PreviewWindow'
import type { PreviewData, ProjectConfig } from '../../types'

export function ExtractionResultView({
  project,
  previews,
}: {
  project: ProjectConfig
  previews: ReadonlyMap<string, PreviewData>
}) {
  const blocks = project.blocks.filter(block => previews.has(block.id))
  const [activeBlockId, setActiveBlockId] = useState(() => {
    return blocks.some(block => block.id === project.activeBlockId) ? project.activeBlockId : blocks[0]?.id ?? ''
  })

  return (
    <PreviewWindow
      previewData={previews.get(activeBlockId) ?? null}
      allBlocks={blocks.map(block => ({ blockId: block.id, label: block.label }))}
      activeBlockId={activeBlockId}
      onBlockChange={setActiveBlockId}
    />
  )
}
