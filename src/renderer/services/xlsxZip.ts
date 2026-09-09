import { inflateSync, strFromU8, unzipSync } from 'fflate'

export interface XlsxZipEntry {
  compressionMethod: number
  compressedSize: number
  offset: number
  centralOffset: number
}

export interface XlsxZipReader {
  get(path: string): Uint8Array | undefined
}

export function createXlsxZipReader(bytes: Uint8Array, entries: Map<string, XlsxZipEntry> | null = readXlsxZipEntries(bytes)): XlsxZipReader {
  return entries ? new SelectiveXlsxZipReader(bytes, entries) : new LegacyXlsxZipReader(bytes)
}

export function readXlsxZipEntries(bytes: Uint8Array): Map<string, XlsxZipEntry> | null {
  const directory = readXlsxZipCentralDirectory(bytes)
  if (!directory) return null
  const entries = new Map<string, XlsxZipEntry>()
  let offset = directory.offset
  const end = directory.offset + directory.size
  while (offset < end) {
    if (offset + 46 > bytes.length || readUint32(bytes, offset) !== 0x02014b50) return null
    const compressionMethod = readUint16(bytes, offset + 10)
    const compressedSize = readUint32(bytes, offset + 20)
    const nameLength = readUint16(bytes, offset + 28)
    const extraLength = readUint16(bytes, offset + 30)
    const commentLength = readUint16(bytes, offset + 32)
    const localHeaderOffset = readUint32(bytes, offset + 42)
    const nameStart = offset + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > bytes.length || next > end || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) return null
    entries.set(strFromU8(bytes.subarray(nameStart, nameStart + nameLength)), {
      compressionMethod,
      compressedSize,
      offset: localHeaderOffset,
      centralOffset: offset,
    })
    offset = next
  }
  return offset === end ? entries : null
}

export function readXlsxZipCentralDirectory(bytes: Uint8Array): { offset: number; size: number; endOffset: number } | null {
  // The end-of-central-directory comment is limited to 65535 bytes.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 0xffff - 22); offset -= 1) {
    if (readUint32(bytes, offset) !== 0x06054b50) continue
    const size = readUint32(bytes, offset + 12)
    const directoryOffset = readUint32(bytes, offset + 16)
    // ZIP64 stores sentinel values here. Fall back to a complete ZIP reader.
    if (size === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + size > bytes.length) return null
    return { offset: directoryOffset, size, endOffset: offset }
  }
  return null
}

class SelectiveXlsxZipReader implements XlsxZipReader {
  private readonly cache = new Map<string, Uint8Array | undefined>()

  constructor(private readonly bytes: Uint8Array, private readonly entries: Map<string, XlsxZipEntry>) {}

  get(path: string): Uint8Array | undefined {
    if (this.cache.has(path)) return this.cache.get(path)
    const entry = this.entries.get(path)
    const value = entry ? readXlsxZipEntry(this.bytes, entry) : undefined
    this.cache.set(path, value)
    return value
  }
}

class LegacyXlsxZipReader implements XlsxZipReader {
  private readonly files: Record<string, Uint8Array>

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes)
  }

  get(path: string): Uint8Array | undefined {
    return this.files[path]
  }
}

function readXlsxZipEntry(bytes: Uint8Array, entry: XlsxZipEntry): Uint8Array | undefined {
  if (entry.offset + 30 > bytes.length || readUint32(bytes, entry.offset) !== 0x04034b50) return undefined
  const nameLength = readUint16(bytes, entry.offset + 26)
  const extraLength = readUint16(bytes, entry.offset + 28)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > bytes.length) return undefined
  const compressed = bytes.subarray(start, end)
  if (entry.compressionMethod === 0) return compressed.slice()
  if (entry.compressionMethod === 8) return inflateSync(compressed)
  return undefined
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
}
