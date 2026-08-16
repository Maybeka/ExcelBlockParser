import { analyzePython, type PythonDefinition } from './pythonSemantics'
import type { PythonProjectFile } from '../types'

export interface PythonExternalDefinition {
  filePath: string
  definition: PythonDefinition
}

function modulePath(moduleName: string): string { return `${moduleName.replace(/\./g, '/')}.py` }

function wordAt(source: string, position: number): string {
  const before = source.slice(0, position).match(/[A-Za-z_]\w*$/)?.[0] ?? ''
  const after = source.slice(position).match(/^\w*/)?.[0] ?? ''
  return `${before}${after}`
}

interface ImportedName { filePath: string; name: string }

function importsIn(source: string): Map<string, ImportedName> {
  const imports = new Map<string, ImportedName>()
  for (const match of source.matchAll(/^\s*from\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+(.+)$/gm)) {
    for (const specifier of match[2].split(',')) {
      const imported = specifier.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/)
      if (imported) imports.set(imported[2] ?? imported[1], { filePath: modulePath(match[1]), name: imported[1] })
    }
  }
  for (const match of source.matchAll(/^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s+as\s+([A-Za-z_]\w*))?/gm)) {
    const alias = match[2] ?? match[1].split('.').at(-1)!
    imports.set(alias, { filePath: modulePath(match[1]), name: '' })
  }
  return imports
}

function findTopLevelDefinition(file: PythonProjectFile | undefined, name: string): PythonDefinition | null {
  if (!file) return null
  return analyzePython(file.source).definitions.find(definition => definition.name === name && !definition.className) ?? null
}

export function resolvePythonPackageDefinition(files: PythonProjectFile[], source: string, position: number): PythonExternalDefinition | null {
  const name = wordAt(source, position)
  if (!name) return null
  const byPath = new Map(files.map(file => [file.path, file]))
  const imports = importsIn(source)
  const direct = imports.get(name)
  if (direct?.name) {
    const definition = findTopLevelDefinition(byPath.get(direct.filePath), direct.name)
    return definition ? { filePath: direct.filePath, definition } : null
  }

  const before = source.slice(0, position)
  const member = before.match(/([A-Za-z_]\w*)\.$/)?.[1]
  if (!member) return null
  const importedModule = imports.get(member)
  if (importedModule && !importedModule.name) {
    const definition = findTopLevelDefinition(byPath.get(importedModule.filePath), name)
    return definition ? { filePath: importedModule.filePath, definition } : null
  }

  const assignments = [...before.matchAll(new RegExp(`\\b${member}\\s*=\\s*([A-Za-z_]\\w*)\\s*\\([^)]*\\)`, 'g'))]
  const assignedClass = assignments.at(-1)?.[1]
  const importedClass = assignedClass ? imports.get(assignedClass) : null
  if (!importedClass?.name) return null
  const targetFile = byPath.get(importedClass.filePath)
  if (!targetFile) return null
  const model = analyzePython(targetFile.source)
  const definition = model.classes.get(importedClass.name)?.members.get(name) ?? null
  return definition ? { filePath: importedClass.filePath, definition } : null
}
