import { describe, expect, it } from 'vitest'
import { parsePythonArtifacts, pythonArtifactSize } from '../services/pythonArtifacts'

describe('Python generated artifact contract', () => {
  it('extracts bounded UTF-8 text artifacts from a result envelope', () => {
    const result = parsePythonArtifacts(JSON.stringify({
      result: { count: 2 },
      artifacts: [
        { path: 'models/customer.py', content: 'class Customer:\n    pass\n' },
        { path: 'schema.json', content: '{"name":"客户"}', encoding: 'utf-8' },
      ],
    }))
    expect(result.error).toBe('')
    expect(result.artifacts.map(artifact => artifact.path)).toEqual(['models/customer.py', 'schema.json'])
    expect(result.artifacts[0].encoding).toBe('utf-8')
    expect(pythonArtifactSize(result.artifacts[1])).toBeGreaterThan(result.artifacts[1].content.length)
  })

  it('leaves ordinary Python results unchanged', () => {
    expect(parsePythonArtifacts('{"records":[]}')).toEqual({ artifacts: [], error: '' })
  })

  it.each([
    [{ artifacts: {} }, 'must be an array'],
    [{ artifacts: [{ path: '../escape.py', content: 'x' }] }, 'not normalized'],
    [{ artifacts: [{ path: 'CON.txt', content: 'x' }] }, 'not valid on Windows'],
    [{ artifacts: [{ path: 'a.py', content: 'x' }, { path: 'A.py', content: 'y' }] }, 'Duplicate artifact path'],
    [{ artifacts: [{ path: 'a.py', content: 'x', encoding: 'base64' }] }, 'utf-8'],
    [{ artifacts: [{ path: 'a.py', content: 'x', executable: true }] }, 'unsupported field'],
  ])('rejects malformed or unsafe artifact output', (value, expected) => {
    expect(parsePythonArtifacts(JSON.stringify(value)).error).toContain(expected)
  })
})
