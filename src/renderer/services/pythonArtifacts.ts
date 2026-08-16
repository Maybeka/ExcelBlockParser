import type { PythonArtifact } from '../../shared/pythonRuntime'

export const MAX_PYTHON_ARTIFACTS = 100
export const MAX_PYTHON_ARTIFACT_BYTES = 5 * 1024 * 1024
export const MAX_PYTHON_ARTIFACT_TOTAL_BYTES = 25 * 1024 * 1024

export interface PythonArtifactParseResult {
  artifacts: PythonArtifact[]
  error: string
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_INVALID_CHARACTER = /[<>:"|?*\u0000-\u001f]/
const utf8Encoder = new TextEncoder()

function validateArtifactPath(value: string): string | null {
  if (!value || utf8Encoder.encode(value).byteLength > 512) return 'Artifact paths must contain between 1 and 512 UTF-8 bytes.'
  if (value.includes('\\')) return `Artifact path "${value}" must use forward slashes.`
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return `Artifact path "${value}" must be relative.`
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return `Artifact path "${value}" is not normalized.`
  for (const segment of segments) {
    if (WINDOWS_INVALID_CHARACTER.test(segment) || segment.endsWith('.') || segment.endsWith(' ') || WINDOWS_RESERVED_NAME.test(segment)) {
      return `Artifact path "${value}" is not valid on Windows.`
    }
  }
  return null
}

export function parsePythonArtifacts(resultJson: string): PythonArtifactParseResult {
  if (!resultJson) return { artifacts: [], error: '' }
  let decoded: unknown
  try { decoded = JSON.parse(resultJson) } catch { return { artifacts: [], error: 'Python result is not valid JSON.' } }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || !('artifacts' in decoded)) return { artifacts: [], error: '' }
  const rawArtifacts = (decoded as Record<string, unknown>).artifacts
  if (!Array.isArray(rawArtifacts)) return { artifacts: [], error: 'Python result artifacts must be an array.' }
  if (rawArtifacts.length > MAX_PYTHON_ARTIFACTS) return { artifacts: [], error: `Python result exceeds the ${MAX_PYTHON_ARTIFACTS}-file limit.` }

  const artifacts: PythonArtifact[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  for (const [index, value] of rawArtifacts.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { artifacts: [], error: `Artifact ${index + 1} must be an object.` }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.some(key => !['path', 'content', 'encoding'].includes(key))) return { artifacts: [], error: `Artifact ${index + 1} contains an unsupported field.` }
    if (typeof record.path !== 'string' || typeof record.content !== 'string') return { artifacts: [], error: `Artifact ${index + 1} must provide string path and content fields.` }
    if (record.encoding !== undefined && record.encoding !== 'utf-8') return { artifacts: [], error: `Artifact "${record.path}" must use utf-8 encoding.` }
    const pathError = validateArtifactPath(record.path)
    if (pathError) return { artifacts: [], error: pathError }
    const canonicalPath = record.path.toLocaleLowerCase('en-US')
    if (paths.has(canonicalPath)) return { artifacts: [], error: `Duplicate artifact path: "${record.path}".` }
    paths.add(canonicalPath)
    const size = utf8Encoder.encode(record.content).byteLength
    if (size > MAX_PYTHON_ARTIFACT_BYTES) return { artifacts: [], error: `Artifact "${record.path}" exceeds the 5 MB limit.` }
    totalBytes += size
    if (totalBytes > MAX_PYTHON_ARTIFACT_TOTAL_BYTES) return { artifacts: [], error: 'Python artifacts exceed the 25 MB total limit.' }
    artifacts.push({ path: record.path, content: record.content, encoding: 'utf-8' })
  }
  return { artifacts, error: '' }
}

export function pythonArtifactSize(artifact: PythonArtifact): number {
  return utf8Encoder.encode(artifact.content).byteLength
}
