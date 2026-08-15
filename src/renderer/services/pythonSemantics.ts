import { pythonLanguage } from '@codemirror/lang-python'
import type { SyntaxNode } from '@lezer/common'

export type PythonDefinitionKind = 'class' | 'function' | 'method' | 'parameter' | 'variable' | 'attribute'

export interface PythonDefinition {
  name: string
  qualifiedName: string
  kind: PythonDefinitionKind
  from: number
  to: number
  scopeFrom: number
  scopeTo: number
  className?: string
  typeName?: string
  signature?: string
}

export interface PythonClassInfo {
  definition: PythonDefinition
  bases: string[]
  members: Map<string, PythonDefinition>
}

export interface PythonSemanticModel {
  source: string
  definitions: PythonDefinition[]
  classes: Map<string, PythonClassInfo>
  resolve(position: number): PythonDefinition | null
  resolveMember(typeName: string, memberName: string): PythonDefinition | null
  inferExpressionType(node: SyntaxNode, position: number, className?: string): string | undefined
}

function text(source: string, node: SyntaxNode | null | undefined): string {
  return node ? source.slice(node.from, node.to) : ''
}

function directChildren(node: SyntaxNode, name?: string): SyntaxNode[] {
  const result: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!name || child.name === name) result.push(child)
  }
  return result
}

function containingBody(node: SyntaxNode): SyntaxNode {
  return node.getChild('Body') ?? node
}

function enclosing(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) return current
  }
  return null
}

function functionSignature(source: string, node: SyntaxNode): string {
  const name = node.getChild('VariableName')
  const params = node.getChild('ParamList')
  const returnType = directChildren(node, 'TypeDef').at(-1)
  return `${text(source, name)}${text(source, params)}${returnType ? ` ${text(source, returnType)}` : ''}`
}

function annotationName(source: string, typeDef: SyntaxNode | null): string | undefined {
  if (!typeDef) return undefined
  const names: string[] = []
  const collect = (node: SyntaxNode) => {
    if (node.name === 'VariableName') names.push(source.slice(node.from, node.to))
    for (let child = node.firstChild; child; child = child.nextSibling) collect(child)
  }
  collect(typeDef)
  return names.at(-1)
}

function declarationNameNode(node: SyntaxNode): SyntaxNode | null {
  return node.getChild('VariableName')
}

export function analyzePython(source: string): PythonSemanticModel {
  const tree = pythonLanguage.parser.parse(source)
  const definitions: PythonDefinition[] = []
  const classes = new Map<string, PythonClassInfo>()

  function addDefinition(definition: PythonDefinition): PythonDefinition {
    definitions.push(definition)
    return definition
  }

  function collectDeclarations(node: SyntaxNode, currentClass?: string): void {
    if (node.name === 'ClassDefinition') {
      const nameNode = declarationNameNode(node)
      if (nameNode) {
        const name = text(source, nameNode)
        const body = containingBody(node)
        const definition = addDefinition({
          name,
          qualifiedName: name,
          kind: 'class',
          from: nameNode.from,
          to: nameNode.to,
          scopeFrom: node.from,
          scopeTo: node.to,
          signature: `class ${name}`,
        })
        const bases = directChildren(node, 'ArgList')[0]
        classes.set(name, {
          definition,
          bases: bases ? directChildren(bases, 'VariableName').map(base => text(source, base)) : [],
          members: new Map(),
        })
        for (const child of directChildren(body)) collectDeclarations(child, name)
        return
      }
    }

    if (node.name === 'FunctionDefinition') {
      const nameNode = declarationNameNode(node)
      if (nameNode) {
        const name = text(source, nameNode)
        const body = containingBody(node)
        const kind = currentClass ? 'method' : 'function'
        const returnType = directChildren(node, 'TypeDef').at(-1)
        const definition = addDefinition({
          name,
          qualifiedName: currentClass ? `${currentClass}.${name}` : name,
          kind,
          from: nameNode.from,
          to: nameNode.to,
          scopeFrom: body.from,
          scopeTo: body.to,
          className: currentClass,
          typeName: annotationName(source, returnType ?? null),
          signature: functionSignature(source, node),
        })
        if (currentClass) classes.get(currentClass)?.members.set(name, definition)

        const params = node.getChild('ParamList')
        if (params) {
          for (const param of directChildren(params, 'VariableName')) {
            const paramName = text(source, param)
            addDefinition({
              name: paramName,
              qualifiedName: `${definition.qualifiedName}.${paramName}`,
              kind: 'parameter',
              from: param.from,
              to: param.to,
              scopeFrom: body.from,
              scopeTo: body.to,
              className: currentClass,
              typeName: paramName === 'self' ? currentClass : annotationName(source, param.nextSibling?.name === 'TypeDef' ? param.nextSibling : null),
            })
          }
        }
        for (const child of directChildren(body)) collectDeclarations(child, currentClass)
        return
      }
    }

    for (const child of directChildren(node)) collectDeclarations(child, currentClass)
  }

  collectDeclarations(tree.topNode)

  function resolveMember(typeName: string, memberName: string, visited = new Set<string>()): PythonDefinition | null {
    if (visited.has(typeName)) return null
    visited.add(typeName)
    const classInfo = classes.get(typeName)
    if (!classInfo) return null
    const own = classInfo.members.get(memberName)
    if (own) return own
    for (const base of classInfo.bases) {
      const inherited = resolveMember(base, memberName, visited)
      if (inherited) return inherited
    }
    return null
  }

  function visibleDefinition(name: string, position: number): PythonDefinition | null {
    const candidates = definitions.filter(definition =>
      definition.name === name
      && definition.from <= position
      && definition.scopeFrom <= position
      && position <= definition.scopeTo,
    )
    return candidates.sort((a, b) => (a.scopeTo - a.scopeFrom) - (b.scopeTo - b.scopeFrom) || b.from - a.from)[0]
      ?? definitions.find(definition => definition.name === name && ['class', 'function'].includes(definition.kind))
      ?? null
  }

  function inferExpressionType(node: SyntaxNode, position: number, className?: string): string | undefined {
    if (node.name === 'VariableName') {
      const name = text(source, node)
      if (name === 'self') return className
      return visibleDefinition(name, position)?.typeName ?? (classes.has(name) ? name : undefined)
    }
    if (node.name === 'CallExpression') {
      const callee = node.firstChild
      if (!callee) return undefined
      if (callee.name === 'VariableName') {
        const name = text(source, callee)
        if (name === 'super' && className) return classes.get(className)?.bases[0]
        if (classes.has(name)) return name
        return visibleDefinition(name, position)?.typeName
      }
      if (callee.name === 'MemberExpression') {
        const property = callee.getChild('PropertyName')
        const receiver = callee.firstChild
        const receiverType = receiver ? inferExpressionType(receiver, position, className) : undefined
        return receiverType && property ? resolveMember(receiverType, text(source, property))?.typeName : undefined
      }
    }
    if (node.name === 'MemberExpression') {
      const property = node.getChild('PropertyName')
      const receiver = node.firstChild
      const receiverType = receiver ? inferExpressionType(receiver, position, className) : undefined
      return receiverType && property ? resolveMember(receiverType, text(source, property))?.typeName : undefined
    }
    return undefined
  }

  function collectBindings(node: SyntaxNode, currentClass?: string, currentFunction?: SyntaxNode): void {
    const nextClass = node.name === 'ClassDefinition' ? text(source, declarationNameNode(node)) : currentClass
    const nextFunction = node.name === 'FunctionDefinition' ? node : currentFunction
    if (node.name === 'AssignStatement' && nextFunction) {
      const assignOp = node.getChild('AssignOp')
      const target = node.firstChild
      const value = assignOp?.nextSibling ?? node.lastChild
      const body = containingBody(nextFunction)
      const explicitType = directChildren(node, 'TypeDef')[0]
      const typeName = annotationName(source, explicitType ?? null)
        ?? (value ? inferExpressionType(value, node.from, nextClass) : undefined)
      if (target?.name === 'VariableName') {
        const name = text(source, target)
        addDefinition({ name, qualifiedName: name, kind: 'variable', from: target.from, to: target.to, scopeFrom: body.from, scopeTo: body.to, className: nextClass, typeName })
      } else if (target?.name === 'MemberExpression' && text(source, target.firstChild) === 'self' && nextClass) {
        const property = target.getChild('PropertyName')
        if (property) {
          const name = text(source, property)
          const definition = addDefinition({ name, qualifiedName: `${nextClass}.${name}`, kind: 'attribute', from: property.from, to: property.to, scopeFrom: classes.get(nextClass)?.definition.scopeFrom ?? 0, scopeTo: classes.get(nextClass)?.definition.scopeTo ?? source.length, className: nextClass, typeName })
          if (!classes.get(nextClass)?.members.has(name)) classes.get(nextClass)?.members.set(name, definition)
        }
      }
    }
    for (const child of directChildren(node)) collectBindings(child, nextClass, nextFunction)
  }

  collectBindings(tree.topNode)

  function resolve(position: number): PythonDefinition | null {
    const node = tree.resolveInner(position, 1)
    if (!['VariableName', 'PropertyName'].includes(node.name)) return null
    const own = definitions.find(definition => definition.from === node.from && definition.to === node.to)
    if (own) return own
    if (node.name === 'VariableName') return visibleDefinition(text(source, node), node.from)

    const member = node.parent
    const receiver = member?.firstChild
    const classNode = enclosing(node, 'ClassDefinition')
    const className = classNode ? text(source, declarationNameNode(classNode)) : undefined
    const receiverType = receiver ? inferExpressionType(receiver, node.from, className) : undefined
    return receiverType ? resolveMember(receiverType, text(source, node)) : null
  }

  return { source, definitions, classes, resolve, resolveMember, inferExpressionType }
}
