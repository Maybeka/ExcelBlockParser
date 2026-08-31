import type { BlockConfig, CellRange } from '../../types'
import type { BlockRangeUpdate } from './rangeResetMigration'

export type BlockRangeSource = Pick<BlockConfig, 'workbookId' | 'activeSheet' | 'range'>
export type BlockRangeReset = BlockRangeSource | BlockRangeUpdate

/** Applies only the source binding selected in the reset workflow. */
export function resetBlockRange(block: BlockConfig, source: BlockRangeReset): BlockConfig {
  return { ...block, ...source }
}
