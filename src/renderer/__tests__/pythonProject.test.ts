import { describe, expect, it } from 'vitest'
import { createProject } from '../services/project'
import { buildPythonProjectContext } from '../services/pythonProject'
import { DEFAULT_PROJECT_PYTHON_SOURCE, createPythonPackage, validatePythonPackage } from '../services/pythonPackage'
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

  it('persists a multi-file Python package in strict Project v3 documents', () => {
    const project = createProject('Python project')
    project.pythonScript = { entryPath: 'main.py', files: [{ path: 'main.py', source: 'from helpers import value\n\ndef process(context): return value()' }, { path: 'helpers.py', source: 'def value(): return 1' }] }
    const encoded = serializeProject(project, null)
    const decoded = loadProject(encoded)
    expect(decoded.errors).toEqual([])
    expect(decoded.project?.project.pythonScript).toEqual(project.pythonScript)
  })

  it('creates new projects with a documented entry module', () => {
    expect(createProject().pythonScript).toEqual(createPythonPackage())
    expect(createProject().pythonScript?.files[0].source).toBe(DEFAULT_PROJECT_PYTHON_SOURCE)
    expect(createProject().pythonScript?.files[1].source).toContain('"artifacts"')
  })

  it('rejects malformed or unsafe package configuration in strict Project v3 input', () => {
    const encoded = serializeProject(createProject('Invalid Python'), null) as unknown as Record<string, unknown>
    ;(encoded.project as Record<string, unknown>).pythonScript = { source: 42 }
    expect(loadProject(encoded).errors).toContain('Invalid project file: Python package is invalid.')
    expect(validatePythonPackage({ entryPath: '../main.py', files: [{ path: '../main.py', source: '' }] })).toContain('entry Python file')
  })
})
