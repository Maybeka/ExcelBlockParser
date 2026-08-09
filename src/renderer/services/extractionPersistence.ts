import type { BlockConfig, ProjectConfig } from '../types'
import type { SpreadsheetCapability } from './spreadsheetCapability'

/** Captures the current workbook's headers without exposing Univer to feature persistence. */
export async function captureExtractionSnapshots(
  project: ProjectConfig,
  activeWorkbookId: string | null,
  spreadsheet: SpreadsheetCapability,
): Promise<ProjectConfig> {
  const blocks = await Promise.all(project.blocks.map(async block => {
    if (block.workbookId !== activeWorkbookId || !block.range || block.headerRows.length === 0) return block
    const values = spreadsheet.readRange(block.activeSheet, block.range)
    if (!values) return block
    const headerSnapshot: string[][] = []
    for (const rowIndex of block.headerRows) {
      if (rowIndex >= values.length) break
      const row = (values[rowIndex] ?? []).map(value => String(value ?? ''))
      for (let column = 1; column < row.length; column++) {
        if (row[column] === 'undefined' || row[column] === 'null' || row[column] === '') row[column] = row[column - 1]
      }
      headerSnapshot.push(row)
    }
    return { ...block, headerSnapshot }
  }))
  const regions = project.regions.map(region => ({
    ...region,
    blocks: region.blocks.map((block, index) => ({ ...block, label: block.label || `block_${index + 1}` })),
  }))
  return {
    ...project,
    blocks: blocks.filter((block): block is BlockConfig => Boolean(block.workbookId)),
    regions: regions.filter(region => Boolean(region.workbookId)),
  }
}
