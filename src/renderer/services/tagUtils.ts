import type { BlockConfig, Tag } from '../types'

/**
 * Returns a new block with the tag appended.
 * If a tag with the same key already exists, it is replaced.
 * The original block is not mutated.
 */
export function addTag(block: BlockConfig, tag: Tag): BlockConfig {
  const existingTags = block.tags ?? []
  const existingIndex = existingTags.findIndex((t) => t.key === tag.key)

  if (existingIndex >= 0) {
    const newTags = [...existingTags]
    newTags[existingIndex] = tag
    return { ...block, tags: newTags }
  }

  return { ...block, tags: [...existingTags, tag] }
}

/**
 * Returns a new block with the tag identified by `tagKey` removed.
 * If the key is not found, the block is returned unchanged.
 * The original block is not mutated.
 */
export function removeTag(block: BlockConfig, tagKey: string): BlockConfig {
  const existingTags = block.tags ?? []
  const newTags = existingTags.filter((t) => t.key !== tagKey)

  if (newTags.length === existingTags.length) {
    return block
  }

  return { ...block, tags: newTags }
}

/**
 * Returns blocks whose tags match the filter string.
 * Matching is done case-insensitively against both tag `key` and tag `value`.
 * If `tagFilter` is empty, all blocks are returned.
 */
export function filterBlocksByTag(blocks: BlockConfig[], tagFilter: string): BlockConfig[] {
  if (!tagFilter) {
    return blocks
  }

  const lowerFilter = tagFilter.toLowerCase()

  return blocks.filter((block) => {
    const tags = block.tags ?? []
    return tags.some(
      (tag) =>
        tag.key.toLowerCase().includes(lowerFilter) ||
        (tag.value && tag.value.toLowerCase().includes(lowerFilter))
    )
  })
}

/**
 * Returns a deduplicated list of all tags across all blocks.
 * Deduplication is by tag `key` (first occurrence wins).
 */
export function getAllTags(blocks: BlockConfig[]): Tag[] {
  const seen = new Set<string>()
  const result: Tag[] = []

  for (const block of blocks) {
    const tags = block.tags ?? []
    for (const tag of tags) {
      if (!seen.has(tag.key)) {
        seen.add(tag.key)
        result.push(tag)
      }
    }
  }

  return result
}
