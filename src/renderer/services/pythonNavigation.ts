import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, keymap, ViewPlugin, type DecorationSet, type Tooltip } from '@codemirror/view'
import { pythonLanguage } from '@codemirror/lang-python'
import { analyzePython, type PythonDefinition, type PythonSemanticModel } from './pythonSemantics'
import type { PythonExternalDefinition } from './pythonPackageNavigation'

type PythonNode = ReturnType<typeof pythonLanguage.parser.parse>['topNode']

export interface PythonSymbol {
  name: string
  qualifiedName: string
  kind: 'class' | 'function' | 'method'
  from: number
}

export interface PythonSymbolNode { symbol: PythonSymbol; children: PythonSymbolNode[] }
interface PythonScope { name: string; kind: PythonSymbol['kind'] }

function collectSymbols(node: PythonNode, source: string, scope: PythonScope[], symbols: PythonSymbol[]): void {
  const isClass = node.name === 'ClassDefinition'
  const isFunction = node.name === 'FunctionDefinition'
  const nameNode = (isClass || isFunction) ? node.getChild('VariableName') : null
  const name = nameNode ? source.slice(nameNode.from, nameNode.to) : ''
  const kind: PythonSymbol['kind'] = isClass ? 'class' : scope.at(-1)?.kind === 'class' ? 'method' : 'function'
  const nextScope = name ? [...scope, { name, kind }] : scope
  if (nameNode && name) symbols.push({ name, qualifiedName: nextScope.map(item => item.name).join('.'), kind, from: nameNode.from })
  for (let child = node.firstChild; child; child = child.nextSibling) collectSymbols(child, source, nextScope, symbols)
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

interface DefinitionTarget { definition: PythonDefinition; from: number; to: number; filePath?: string }
export interface PythonNavigationOptions {
  resolveExternal?: (source: string, position: number) => PythonExternalDefinition | null
  openExternal?: (target: PythonExternalDefinition) => void
}

function findDefinitionTarget(state: EditorState, position: number, options?: PythonNavigationOptions): DefinitionTarget | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const node = tree.resolveInner(position, -1)
  if (!['VariableName', 'PropertyName'].includes(node.name)) return null
  const source = state.doc.toString()
  const definition = analyzePython(source).resolve(node.from)
  if (definition) return { definition, from: node.from, to: node.to }
  const external = options?.resolveExternal?.(source, node.from)
  return external ? { definition: external.definition, from: node.from, to: node.to, filePath: external.filePath } : null
}

export function findPythonDefinition(state: EditorState, position = state.selection.main.head): PythonDefinition | null {
  return findDefinitionTarget(state, position)?.definition ?? null
}

export function jumpToPythonOffset(view: EditorView, offset: number): void {
  view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'center' }) })
  view.focus()
}

function goToDefinition(view: EditorView, options?: PythonNavigationOptions): boolean {
  const target = findDefinitionTarget(view.state, view.state.selection.main.head, options)
  if (!target) return false
  if (target.filePath) options?.openExternal?.({ filePath: target.filePath, definition: target.definition })
  else jumpToPythonOffset(view, target.definition.from)
  return true
}

interface DefinitionHoverState { from: number; to: number; decorations: DecorationSet }
const setDefinitionHover = StateEffect.define<{ from: number; to: number } | null>()
const emptyDefinitionHover: DefinitionHoverState = { from: -1, to: -1, decorations: Decoration.none }
const definitionHoverField = StateField.define<DefinitionHoverState>({
  create: () => emptyDefinitionHover,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setDefinitionHover)) continue
      if (!effect.value) return emptyDefinitionHover
      const { from, to } = effect.value
      return { from, to, decorations: Decoration.set([Decoration.mark({ class: 'cm-python-definition-link' }).range(from, to)]) }
    }
    return transaction.docChanged && value.from >= 0 ? emptyDefinitionHover : value
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

function semanticClass(definition: PythonDefinition, parentName: string): string | null {
  if (definition.kind === 'class') return parentName === 'CallExpression' ? 'cm-python-constructor' : 'cm-python-class'
  if (definition.kind === 'method') return 'cm-python-method'
  if (definition.kind === 'function') return 'cm-python-function'
  if (definition.kind === 'attribute') return 'cm-python-attribute'
  if (definition.typeName) return 'cm-python-instance'
  return null
}

function semanticDecorations(state: EditorState, options?: PythonNavigationOptions): DecorationSet {
  const model = analyzePython(state.doc.toString())
  const builder = new RangeSetBuilder<Decoration>()
  const cursor = syntaxTree(state).cursor()
  do {
    if (!['VariableName', 'PropertyName'].includes(cursor.name)) continue
    const definition = model.resolve(cursor.from) ?? options?.resolveExternal?.(state.doc.toString(), cursor.from)?.definition
    if (!definition) continue
    const className = semanticClass(definition, cursor.node.parent?.name ?? '')
    if (className) builder.add(cursor.from, cursor.to, Decoration.mark({ class: className }))
  } while (cursor.next())
  return builder.finish()
}

function memberCompletions(model: PythonSemanticModel, typeName: string): Completion[] {
  const completions = new Map<string, Completion>()
  const visit = (name: string, inherited = false) => {
    const info = model.classes.get(name)
    if (!info) return
    for (const definition of info.members.values()) {
      if (!completions.has(definition.name)) completions.set(definition.name, {
        label: definition.name,
        type: definition.kind === 'method' ? 'method' : 'property',
        detail: inherited ? `inherited from ${name}` : definition.signature ?? definition.typeName,
      })
    }
    for (const base of info.bases) visit(base, true)
  }
  visit(typeName)
  return [...completions.values()]
}

function pythonSemanticCompletion(context: CompletionContext): CompletionResult | null {
  const source = context.state.doc.toString()
  const model = analyzePython(source)
  const before = source.slice(0, context.pos)
  const memberMatch = before.match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/)
  if (memberMatch) {
    const receiverOffset = context.pos - memberMatch[0].length
    const receiver = model.resolve(receiverOffset)
    if (!receiver?.typeName) return null
    return { from: context.pos - (memberMatch[2]?.length ?? 0), options: memberCompletions(model, receiver.typeName), validFor: /^\w*$/ }
  }
  const word = context.matchBefore(/\w*/)
  if (!word || (!context.explicit && word.from === word.to)) return null
  const seen = new Set<string>()
  const options: Completion[] = []
  for (const definition of model.definitions) {
    if (['attribute', 'parameter'].includes(definition.kind) || seen.has(definition.name)) continue
    seen.add(definition.name)
    options.push({ label: definition.name, type: definition.kind === 'class' ? 'class' : definition.kind, detail: definition.signature })
  }
  return { from: word.from, options, validFor: /^\w*$/ }
}

function pythonSyntaxDiagnostics(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const cursor = syntaxTree(view.state).cursor()
  do {
    if (cursor.type.isError) diagnostics.push({
      from: cursor.from,
      to: Math.min(view.state.doc.length, Math.max(cursor.to, cursor.from + 1)),
      severity: 'error',
      message: 'Invalid Python syntax',
    })
  } while (cursor.next())
  return diagnostics
}

function pythonDefinitionTooltip(options?: PythonNavigationOptions) { return hoverTooltip((view, position): Tooltip | null => {
  const target = findDefinitionTarget(view.state, position, options)
  if (!target) return null
  const definition = target.definition
  const detail = definition.signature ?? `${definition.kind} ${definition.qualifiedName}${definition.typeName ? `: ${definition.typeName}` : ''}`
  return {
    pos: target.from,
    end: target.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'cm-python-semantic-tooltip'
      const title = document.createElement('strong')
      title.textContent = detail
      dom.append(title)
      if (target.filePath || (definition.className && definition.kind === 'method')) {
        const owner = document.createElement('small')
        owner.textContent = target.filePath ? `Defined in ${target.filePath}` : `Defined in ${definition.className}`
        dom.append(owner)
      }
      return { dom }
    },
  }
}) }

export function pythonNavigation(options?: PythonNavigationOptions): Extension {
  const highlights = StateField.define<DecorationSet>({
    create: state => semanticDecorations(state, options),
    update(value, transaction) { return transaction.docChanged ? semanticDecorations(transaction.state, options) : value },
    provide: field => EditorView.decorations.from(field),
  })
  return [
    definitionHoverField,
    definitionHoverRelease,
    highlights,
    pythonDefinitionTooltip(options),
    autocompletion({ override: [pythonSemanticCompletion], activateOnTyping: true }),
    linter(pythonSyntaxDiagnostics, { delay: 250 }),
    keymap.of([{ key: 'F12', run: view => goToDefinition(view, options) }]),
    EditorView.domEventHandlers({
      mousemove(event, view) {
        if (!(event.metaKey || event.ctrlKey)) { updateDefinitionHover(view, null); return false }
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        const target = position === null ? null : findDefinitionTarget(view.state, position, options)
        updateDefinitionHover(view, target ? { from: target.from, to: target.to } : null)
        return false
      },
      mouseleave(_event, view) { updateDefinitionHover(view, null); return false },
      keyup(event, view) {
        if (event.key === 'Meta' || event.key === 'Control') updateDefinitionHover(view, null)
        return false
      },
      mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null) return false
        const target = findDefinitionTarget(view.state, position, options)
        if (!target) return false
        event.preventDefault()
        updateDefinitionHover(view, null)
        if (target.filePath) options?.openExternal?.({ filePath: target.filePath, definition: target.definition })
        else jumpToPythonOffset(view, target.definition.from)
        return true
      },
    }),
  ]
}
