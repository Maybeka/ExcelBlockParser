import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { pythonLanguage } from '@codemirror/lang-python'

type PythonNode = ReturnType<typeof pythonLanguage.parser.parse>['topNode']

export interface PythonSymbol {
  name: string
  qualifiedName: string
  kind: 'class' | 'function' | 'method'
  from: number
}

interface PythonScope {
  name: string
  kind: PythonSymbol['kind']
}

function collectSymbols(node: PythonNode, source: string, scope: PythonScope[], symbols: PythonSymbol[]): void {
  const isClass = node.name === 'ClassDefinition'
  const isFunction = node.name === 'FunctionDefinition'
  const nameNode = (isClass || isFunction) ? node.getChild('VariableName') : null
  const name = nameNode ? source.slice(nameNode.from, nameNode.to) : ''
  const kind: PythonSymbol['kind'] = isClass ? 'class' : scope.at(-1)?.kind === 'class' ? 'method' : 'function'
  const nextScope = name ? [...scope, { name, kind }] : scope

  if (nameNode && name) {
    symbols.push({
      name,
      qualifiedName: nextScope.map(item => item.name).join('.'),
      kind,
      from: nameNode.from,
    })
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectSymbols(child, source, nextScope, symbols)
  }
}

export function listPythonSymbols(source: string): PythonSymbol[] {
  const symbols: PythonSymbol[] = []
  collectSymbols(pythonLanguage.parser.parse(source).topNode, source, [], symbols)
  return symbols
}

export function findPythonDefinition(state: EditorState, position = state.selection.main.head): PythonSymbol | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const node = tree.resolveInner(position, -1)
  if (node.name !== 'VariableName') return null
  const name = state.doc.sliceString(node.from, node.to)
  const symbols = listPythonSymbols(state.doc.toString()).filter(symbol => symbol.name === name)
  const exactDefinition = symbols.find(symbol => symbol.from === node.from)
  if (exactDefinition) return exactDefinition
  return symbols.filter(symbol => symbol.from < node.from).at(-1) ?? symbols[0] ?? null
}

export function jumpToPythonOffset(view: EditorView, offset: number): void {
  view.dispatch({
    selection: { anchor: offset },
    effects: EditorView.scrollIntoView(offset, { y: 'center' }),
  })
  view.focus()
}

function goToDefinition(view: EditorView): boolean {
  const definition = findPythonDefinition(view.state)
  if (!definition) return false
  jumpToPythonOffset(view, definition.from)
  return true
}

export function pythonNavigation(): Extension {
  return [
    keymap.of([{ key: 'F12', run: goToDefinition }]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null) return false
        const definition = findPythonDefinition(view.state, position)
        if (!definition) return false
        event.preventDefault()
        jumpToPythonOffset(view, definition.from)
        return true
      },
    }),
  ]
}
