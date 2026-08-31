import type { BlockConfig, CellRange } from '../../types'

export type BlockRangeSource = Pick<BlockConfig, 'workbookId' | 'activeSheet' | 'range'>

/** Applies only the source binding selected in the reset workflow. */
export function resetBlockRange(block: BlockConfig, source: BlockRangeSource): BlockConfig {
  return { ...block, ...source }
}
