import assert from 'node:assert/strict'
import test from 'node:test'
import { powershellLiteral } from './windows-powershell.mjs'

test('quotes PowerShell literal paths without positional argument binding', () => {
  assert.equal(powershellLiteral('C:\\Release Files\\app.exe'), "'C:\\Release Files\\app.exe'")
  assert.equal(powershellLiteral("C:\\Owner's Build\\app.exe"), "'C:\\Owner''s Build\\app.exe'")
})
