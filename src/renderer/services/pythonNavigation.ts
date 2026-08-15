import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet } from '@codemirror/view'
import { pythonLanguage } from '@codemirror/lang-python'

type PythonNode = ReturnType<typeof pythonLanguage.parser.parse>['topNode']

export interface PythonSymbol {
  name: string
  qualifiedName: string
  kind: 'class' | 'function' | 'method'
  from: number
}

export interface PythonSymbolNode {
  symbol: PythonSymbol
  children: PythonSymbolNode[]
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

export function buildPythonSymbolTree(symbols: PythonSymbol[]): PythonSymbolNode[] {
  const roots: PythonSymbolNode[] = []
  const nodes = new Map<string, PythonSymbolNode>()
  for (const symbol of symbols) {
    const node = { symbol, children: [] }
    nodes.set(symbol.qualifiedName, node)
    const separator = symbol.qualifiedName.lastIndexOf('.')
    const parent = separator > 0 ? nodes.get(symbol.qualifiedName.slice(0, separator)) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

interface DefinitionTarget {
  definition: PythonSymbol
  from: number
  to: number
}

function findDefinitionTarget(state: EditorState, position: number): DefinitionTarget | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const node = tree.resolveInner(position, -1)
  if (node.name !== 'VariableName') return null
  const name = state.doc.sliceString(node.from, node.to)
  const symbols = listPythonSymbols(state.doc.toString()).filter(symbol => symbol.name === name)
  const exactDefinition = symbols.find(symbol => symbol.from === node.from)
  const definition = exactDefinition
    ?? symbols.filter(symbol => symbol.from < node.from).at(-1)
    ?? symbols[0]
  return definition ? { definition, from: node.from, to: node.to } : null
}

export function findPythonDefinition(state: EditorState, position = state.selection.main.head): PythonSymbol | null {
  return findDefinitionTarget(state, position)?.definition ?? null
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

interface DefinitionHoverState {
  from: number
  to: number
  decorations: DecorationSet
}

const setDefinitionHover = StateEffect.define<{ from: number; to: number } | null>()
const emptyDefinitionHover: DefinitionHoverState = { from: -1, to: -1, decorations: Decoration.none }
const definitionHoverField = StateField.define<DefinitionHoverState>({
  create: () => emptyDefinitionHover,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setDefinitionHover)) continue
      if (!effect.value) return emptyDefinitionHover
      const { from, to } = effect.value
      return {
        from,
        to,
        decorations: Decoration.set([Decoration.mark({ class: 'cm-python-definition-link' }).range(from, to)]),
      }
    }
    if (!transaction.docChanged || value.from < 0) return value
    return emptyDefinitionHover
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

function updateDefinitionHover(view: EditorView, target: { from: number; to: number } | null): void {
  const current = view.state.field(definitionHoverField)
  if (current.from === (target?.from ?? -1) && current.to === (target?.to ?? -1)) return
  view.dispatch({ effects: setDefinitionHover.of(target) })
}

const definitionHoverRelease = ViewPlugin.fromClass(class {
  private readonly clearModifier = (event: KeyboardEvent) => {
    if (event.key === 'Meta' || event.key === 'Control') updateDefinitionHover(this.view, null)
  }

  private readonly clearAll = () => updateDefinitionHover(this.view, null)

  constructor(private readonly view: EditorView) {
    window.addEventListener('keyup', this.clearModifier)
    window.addEventListener('blur', this.clearAll)
  }

  destroy(): void {
    window.removeEventListener('keyup', this.clearModifier)
    window.removeEventListener('blur', this.clearAll)
  }
})

export function pythonNavigation(): Extension {
  return [
    definitionHoverField,
    definitionHoverRelease,
    keymap.of([{ key: 'F12', run: goToDefinition }]),
    EditorView.domEventHandlers({
      mousemove(event, view) {
        if (!(event.metaKey || event.ctrlKey)) {
          updateDefinitionHover(view, null)
          return false
        }
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        const target = position === null ? null : findDefinitionTarget(view.state, position)
        updateDefinitionHover(view, target ? { from: target.from, to: target.to } : null)
        return false
      },
      mouseleave(_event, view) {
        updateDefinitionHover(view, null)
        return false
      },
      keyup(event, view) {
        if (event.key === 'Meta' || event.key === 'Control') updateDefinitionHover(view, null)
        return false
      },
      mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null) return false
        const definition = findPythonDefinition(view.state, position)
        if (!definition) return false
        event.preventDefault()
        updateDefinitionHover(view, null)
        jumpToPythonOffset(view, definition.from)
        return true
      },
    }),
  ]
}
