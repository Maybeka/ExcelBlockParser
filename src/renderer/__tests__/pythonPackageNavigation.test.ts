import { describe, expect, it } from 'vitest'
import { resolvePythonPackageDefinition } from '../services/pythonPackageNavigation'
import type { PythonProjectFile } from '../types'

const files: PythonProjectFile[] = [
  {
    path: 'main.py',
    source: [
      'from generators.models import Builder, transform',
      '',
      'def process(context):',
      '    builder = Builder()',
      '    return transform(builder.render(context))',
    ].join('\n'),
  },
  {
    path: 'generators/models.py',
    source: [
      'class Builder:',
      '    def render(self, context):',
      '        return context',
      '',
      'def transform(value):',
      '    return value',
    ].join('\n'),
  },
]

describe('resolvePythonPackageDefinition', () => {
  it('resolves direct imports and methods on instances of imported classes', () => {
    const source = files[0].source
    const direct = resolvePythonPackageDefinition(files, source, source.indexOf('transform(builder'))
    const method = resolvePythonPackageDefinition(files, source, source.indexOf('render(context)'))

    expect(direct).toMatchObject({ filePath: 'generators/models.py', definition: { qualifiedName: 'transform', kind: 'function' } })
    expect(method).toMatchObject({ filePath: 'generators/models.py', definition: { qualifiedName: 'Builder.render', kind: 'method' } })
  })
})
