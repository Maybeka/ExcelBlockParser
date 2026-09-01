export type JsonRecord = Record<string, unknown>

export interface JsonParseResult {
  value?: unknown
  error?: string
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function describeJsonValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (Number.isNaN(value)) return 'NaN'
  return typeof value
}

export function jsonFieldPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

export function findInvalidJsonValue(value: unknown, path: string): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} must be a finite JSON number; received ${describeJsonValue(value)}.`
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const error = findInvalidJsonValue(value[index], `${path}[${index}]`)
      if (error) return error
    }
    return null
  }
  if (isJsonRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const error = findInvalidJsonValue(child, jsonFieldPath(path, key))
      if (error) return error
    }
    return null
  }
  return `${path} must be a JSON value; received ${describeJsonValue(value)}.`
}

export function parseJsonDocument(content: string): JsonParseResult {
  try {
    return { value: JSON.parse(content) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const location = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
    const position = message.match(/position\s+(\d+)/i)
    if (location) return { error: `Invalid JSON syntax at line ${location[1]}, column ${location[2]}.` }
    if (position) {
      const offset = Number(position[1])
      const before = content.slice(0, offset)
      const line = before.split('\n').length
      const column = offset - before.lastIndexOf('\n')
      return { error: `Invalid JSON syntax at line ${line}, column ${column}.` }
    }
    return { error: 'Invalid JSON syntax.' }
  }
}
