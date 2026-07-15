import { describe, it, expect } from 'vitest'
import { validateExpression } from '../services/pythonValidator'

describe('validateExpression', () => {
  it('accepts valid expression with known keys', () => {
    const result = validateExpression("row['amount'] * row['price']", ['amount', 'price'])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accepts expression using Python builtins', () => {
    const result = validateExpression("sum(row['values'])", ['values'])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports unknown key', () => {
    const result = validateExpression("row['foo']", ['amount'])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("Unknown key: 'foo'")
  })

  it('reports multiple unknown keys', () => {
    const result = validateExpression("row['a'] + row['b']", [])
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(2)
    expect(result.errors).toContain("Unknown key: 'a'")
    expect(result.errors).toContain("Unknown key: 'b'")
  })

  it('treats empty expression as valid', () => {
    const result = validateExpression('', ['amount'])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('treats whitespace-only expression as valid', () => {
    const result = validateExpression('   \t  ', ['amount'])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports syntax error for unbalanced brackets', () => {
    const result = validateExpression("row['a'", ['a'])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/^Syntax error:/)
  })

  it('accepts len() with row key', () => {
    const result = validateExpression("len(row['items']) > 0", ['items'])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accepts ternary expression with row keys', () => {
    const result = validateExpression("row['amount'] if row['amount'] > 0 else 0", ['amount'])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('extracts all keys from expression with multiple references', () => {
    const result = validateExpression(
      "row['a'] + row['b'] + row['c']",
      ['a', 'b', 'c'],
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('flags unknown bare identifier as key', () => {
    const result = validateExpression('amount * price', ['amount'])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain("'price'")
  })

  it('accepts valid bare identifiers matching keys', () => {
    const result = validateExpression('amount * price', ['amount', 'price'])
    expect(result.valid).toBe(true)
  })
})
