import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { buildPythonSymbolTree, findPythonDefinition, listPythonSymbols } from '../services/pythonNavigation'
import { analyzePython } from '../services/pythonSemantics'

const source = `class Builder:
    def render(self):
        return helper()

def helper():
    return 1

def process(context):
    return helper()
`

describe('Python navigation', () => {
  it('lists classes, methods, and functions with qualified names', () => {
    expect(listPythonSymbols(source).map(symbol => [symbol.kind, symbol.qualifiedName])).toEqual([
      ['class', 'Builder'],
      ['method', 'Builder.render'],
      ['function', 'helper'],
      ['function', 'process'],
    ])
  })

  it('nests class methods beneath their class', () => {
    const tree = buildPythonSymbolTree(listPythonSymbols(source))
    expect(tree.map(node => node.symbol.name)).toEqual(['Builder', 'helper', 'process'])
    expect(tree[0].children.map(node => node.symbol.name)).toEqual(['render'])
  })

  it('resolves a local function reference to its definition', () => {
    const state = EditorState.create({ doc: source, extensions: [python()] })
    const reference = source.lastIndexOf('helper') + 2
    const definition = findPythonDefinition(state, reference)
    expect(definition?.qualifiedName).toBe('helper')
    expect(definition?.from).toBe(source.indexOf('helper():'))
  })

  it('distinguishes class construction and resolves instance methods', () => {
    const typedSource = `class Builder:
    def render(self, value: int) -> str:
        return str(value)

def process(context):
    builder = Builder()
    return builder.render(1)
`
    const model = analyzePython(typedSource)
    const constructor = model.resolve(typedSource.indexOf('Builder()') + 2)
    const instance = model.resolve(typedSource.indexOf('builder.render') + 2)
    const method = model.resolve(typedSource.indexOf('render(1)') + 2)

    expect(constructor?.kind).toBe('class')
    expect(instance?.typeName).toBe('Builder')
    expect(method?.qualifiedName).toBe('Builder.render')
    expect(method?.signature).toBe('render(self, value: int) -> str')
  })

  it('resolves inherited and self attribute methods', () => {
    const inheritedSource = `class Base:
    def run(self):
        return 1

class Child(Base):
    def __init__(self):
        self.worker = Base()

    def execute(self):
        return self.worker.run()

def process(context):
    child: Child = Child()
    return child.run()
`
    const model = analyzePython(inheritedSource)
    const selfMethod = model.resolve(inheritedSource.indexOf('run()', inheritedSource.indexOf('self.worker')) + 1)
    const inheritedMethod = model.resolve(inheritedSource.lastIndexOf('run()') + 1)

    expect(selfMethod?.qualifiedName).toBe('Base.run')
    expect(inheritedMethod?.qualifiedName).toBe('Base.run')
  })
})
