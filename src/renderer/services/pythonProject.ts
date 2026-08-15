import type { ParseResult, ProjectConfig } from '../types'

export const PYTHON_CONTEXT_VERSION = 1 as const

export const DEFAULT_PROJECT_PYTHON_SOURCE = `def process(context):
    """Transform the complete parsed project result.

    context["data"] contains the data section from Run & Preview.
    The return value must be JSON serializable.
    """
    return {
        "project": context["project"]["name"],
        "data": context["data"],
    }
`

export interface PythonProjectContext {
  contractVersion: typeof PYTHON_CONTEXT_VERSION
  project: {
    id: string
    name: string
    workbooks: Array<{
      id: string
      name: string
      sheetNames: string[]
    }>
  }
  data: Record<string, unknown>
  blockResults: ParseResult['blocks']
  regionResults: NonNullable<ParseResult['regionResults']>
}

export function buildPythonProjectContext(project: ProjectConfig, result: ParseResult): PythonProjectContext {
  return {
    contractVersion: PYTHON_CONTEXT_VERSION,
    project: {
      id: project.id,
      name: project.name,
      workbooks: project.workbooks.map(workbook => ({
        id: workbook.id,
        name: workbook.name,
        sheetNames: [...(workbook.sheetNames ?? [])],
      })),
    },
    data: result.data,
    blockResults: result.blocks,
    regionResults: result.regionResults ?? [],
  }
}
