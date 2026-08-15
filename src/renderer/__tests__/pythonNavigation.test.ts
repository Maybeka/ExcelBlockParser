import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { buildPythonSymbolTree, findPythonDefinition, listPythonSymbols } from '../services/pythonNavigation'

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
})
