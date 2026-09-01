export type WorkbookSourceFingerprints = Readonly<Record<string, string>>

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_MASK = 0xffffffffffffffffn

/**
 * Produces a stable content identifier without retaining another copy of the
 * workbook. This is only used to decide whether a preview needs confirmation.
 */
export function fingerprintWorkbookSource(buffer: ArrayBuffer): string {
  let hash = FNV_OFFSET_BASIS
  for (const byte of new Uint8Array(buffer)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return `${buffer.byteLength}:${hash.toString(16).padStart(16, '0')}`
}

export function changedWorkbookSourceIds(
  previous: WorkbookSourceFingerprints | null,
  current: WorkbookSourceFingerprints,
): string[] {
  if (!previous) return []
  return Object.keys(current).filter(workbookId => previous[workbookId] !== undefined && previous[workbookId] !== current[workbookId])
}
