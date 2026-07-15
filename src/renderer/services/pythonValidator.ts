export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const PYTHON_BUILTINS = new Set([
  'len', 'str', 'int', 'float', 'bool', 'sum', 'max', 'min', 'abs', 'round',
  'isinstance', 'type', 'list', 'dict', 'tuple', 'set', 'print', 'range',
  'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed', 'any', 'all',
  'True', 'False', 'None',
  'and', 'or', 'not', 'in', 'is', 'if', 'else', 'for', 'while', 'lambda',
  'def', 'class', 'import', 'from', 'as', 'with', 'try', 'except', 'finally',
  'raise', 'return', 'yield', 'break', 'continue', 'pass',
  'math',
])

/**
 * Validates a Python expression and verifies all column key references
 * (row['key']) exist in the provided available keys list.
 *
 * An empty or whitespace-only expression is valid (represents no property).
 */
export function validateExpression(
  expression: string,
  availableKeys: string[],
): ValidationResult {
  const errors: string[] = []

  if (expression.trim() === '') {
    return { valid: true, errors: [] }
  }

  const syntaxError = checkSyntax(expression)
  if (syntaxError) {
    errors.push(`Syntax error: ${syntaxError}`)
  }

  const referencedKeys = extractKeys(expression)
  const availableSet = new Set(availableKeys)
  for (const key of referencedKeys) {
    if (!availableSet.has(key) && !PYTHON_BUILTINS.has(key)) {
      errors.push(`Unknown key: '${key}'`)
    }
  }

  return { valid: errors.length === 0, errors }
}

function extractKeys(expression: string): string[] {
  const keys: string[] = []

  const bracketPattern = /row\s*\[\s*['"](\w+)['"]\s*\]/g
  let match: RegExpExecArray | null
  while ((match = bracketPattern.exec(expression)) !== null) {
    keys.push(match[1])
  }

  const stripped = expression.replace(/row\s*\[\s*['"]\w+['"]\s*\]/g, '')
  const identPattern = /[a-zA-Z_]\w*/g
  while ((match = identPattern.exec(stripped)) !== null) {
    const id = match[0]
    if (!PYTHON_BUILTINS.has(id) && id !== 'row') {
      keys.push(id)
    }
  }

  return keys
}

function checkSyntax(expr: string): string | null {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === '\\') { i++; continue }
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
  }
  if (inSingle) return 'unterminated single-quoted string'
  if (inDouble) return 'unterminated double-quoted string'

  const withoutStrings = stripStringContents(expr)

  if (!balanced(withoutStrings, '(', ')')) {
    return 'unbalanced parentheses'
  }
  if (!balanced(withoutStrings, '[', ']')) {
    return 'unbalanced square brackets'
  }
  if (!balanced(withoutStrings, '{', '}')) {
    return 'unbalanced curly braces'
  }

  return null
}

function balanced(str: string, open: string, close: string): boolean {
  let depth = 0
  for (const ch of str) {
    if (ch === open) {
      depth++
    } else if (ch === close) {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function stripStringContents(expr: string): string {
  let result = ''
  let i = 0

  while (i < expr.length) {
    const ch = expr[i]

    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < expr.length) {
        if (expr[i] === '\\') {
          i += 2
        } else if (expr[i] === quote) {
          i++
          break
        } else {
          i++
        }
      }
    } else {
      result += ch
      i++
    }
  }

  return result
}
