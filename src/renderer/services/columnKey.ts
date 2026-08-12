export function columnKeyFromHeaders(parts: string[]): string {
  return parts
    .map(part => part.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').toLowerCase())
    .filter(Boolean)
    .join('_')
    .replace(/^(\d)/, '_$1')
    || 'column'
}
