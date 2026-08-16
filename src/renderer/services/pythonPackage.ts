import type { PythonProjectFile, PythonScriptConfig } from '../types'

export const MAX_PYTHON_PROJECT_BYTES = 8 * 1024 * 1024
export const MAX_PYTHON_FILE_BYTES = 2 * 1024 * 1024
export const DEFAULT_PROJECT_PYTHON_ENTRY = 'main.py'

export const DEFAULT_PROJECT_PYTHON_SOURCE = `from generators.summary import build_result


def process(context):
    """Transform the complete parsed project result.

    context["data"] contains the current parsed project data.
    The return value must be JSON serializable.
    Add a top-level "artifacts" list to preview and save UTF-8 text files.
    """
    return build_result(context)
`

export const DEFAULT_PROJECT_PYTHON_HELPER_SOURCE = `import json


def build_result(context):
    summary = {
        "project": context["project"]["name"],
        "data": context["data"],
    }
    return {
        "result": summary,
        "artifacts": [
            {
                "path": "generated/project-summary.json",
                "content": json.dumps(summary, ensure_ascii=False, indent=2),
            },
            {
                "path": "generated/project_data.py",
                "content": "PROJECT_DATA = " + repr(summary) + "\\n",
            },
            {
                "path": "generated/project_summary.sv",
                "content": "module project_summary;\\n  localparam string PROJECT_NAME = \\\"" + summary["project"] + "\\\";\\nendmodule\\n",
            },
        ],
    }
`

export function createPythonPackage(): PythonScriptConfig {
  return {
    entryPath: DEFAULT_PROJECT_PYTHON_ENTRY,
    files: [
      { path: DEFAULT_PROJECT_PYTHON_ENTRY, source: DEFAULT_PROJECT_PYTHON_SOURCE },
      { path: 'generators/summary.py', source: DEFAULT_PROJECT_PYTHON_HELPER_SOURCE },
    ],
  }
}

export function normalizePythonPath(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return null
  const parts = normalized.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) return null
  if (!normalized.endsWith('.py')) return null
  return normalized
}

export function validatePythonPackage(value: PythonScriptConfig): string | null {
  const entryPath = normalizePythonPath(value.entryPath)
  if (!entryPath || value.files.length === 0) return 'Python package requires an entry Python file.'
  const names = new Set<string>()
  let totalBytes = 0
  for (const file of value.files) {
    const path = normalizePythonPath(file.path)
    if (!path || typeof file.source !== 'string') return 'Python package contains an invalid file.'
    const key = path.toLocaleLowerCase('en-US')
    if (names.has(key)) return `Python package contains duplicate path: ${path}`
    names.add(key)
    const bytes = new TextEncoder().encode(file.source).byteLength
    if (bytes > MAX_PYTHON_FILE_BYTES) return `Python file exceeds the ${MAX_PYTHON_FILE_BYTES / 1024} KB limit: ${path}`
    totalBytes += bytes
  }
  if (totalBytes > MAX_PYTHON_PROJECT_BYTES) return `Python package exceeds the ${MAX_PYTHON_PROJECT_BYTES / 1024 / 1024} MB limit.`
  if (!names.has(entryPath.toLocaleLowerCase('en-US'))) return 'Python package entry file is missing.'
  return null
}

export function sourceForPythonFile(pythonScript: PythonScriptConfig | undefined, path: string): string {
  return pythonScript?.files.find(file => file.path === path)?.source ?? ''
}

export type { PythonProjectFile }
