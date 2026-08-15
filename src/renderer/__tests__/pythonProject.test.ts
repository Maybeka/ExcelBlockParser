import { describe, expect, it } from 'vitest'
import { createProject } from '../services/project'
import { buildPythonProjectContext, DEFAULT_PROJECT_PYTHON_SOURCE } from '../services/pythonProject'
import { loadProject, serializeProject } from '../services/serializer'

describe('project Python contract', () => {
  it('passes parsed data and result details without local workbook paths', () => {
    const project = {
      ...createProject('Demo'),
      workbooks: [{ id: 'book', name: 'book.xlsx', sourcePath: '/private/book.xlsx', sheetNames: ['Sheet1'] }],
    }
    const context = buildPythonProjectContext(project, {
      success: true,
      data: { book: { records: [{ value: 7 }] } },
      blocks: [{ blockId: 'block', label: 'records', workbookId: 'book', data: [{ value: 7 }], rowCount: 1 }],
      regionResults: [],
    })
    expect(context.contractVersion).toBe(1)
    expect(context.data).toEqual({ book: { records: [{ value: 7 }] } })
    expect(context.project.workbooks[0]).toEqual({ id: 'book', name: 'book.xlsx', sheetNames: ['Sheet1'] })
    expect(context.project.workbooks[0]).not.toHaveProperty('sourcePath')
  })

  it('persists the project script in strict Project v3 documents', () => {
    const project = createProject('Python project')
    project.pythonScript = { source: 'def process(context):\n    return context["data"]\n' }
    const encoded = serializeProject(project, null)
    const decoded = loadProject(encoded)
    expect(decoded.errors).toEqual([])
    expect(decoded.project?.project.pythonScript).toEqual(project.pythonScript)
  })

  it('creates new projects with the documented process entry point', () => {
    expect(createProject().pythonScript?.source).toBe(DEFAULT_PROJECT_PYTHON_SOURCE)
  })

  it('rejects malformed script configuration in strict Project v3 input', () => {
    const encoded = serializeProject(createProject('Invalid Python'), null) as unknown as Record<string, unknown>
    ;(encoded.project as Record<string, unknown>).pythonScript = { source: 42 }
    expect(loadProject(encoded).errors).toContain('Invalid project file: Python script is invalid.')
  })
})
