import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { releaseVersionForPackage } from './release-version.mjs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('accepts matching versioned release tags', () => {
  assert.equal(releaseVersionForPackage('1.0.0', 'tag', 'v1.0.0'), '1.0.0')
  assert.equal(releaseVersionForPackage('1.0.0-rc.1', 'tag', 'v1.0.0-rc.1'), '1.0.0-rc.1')
})

test('rejects a tag that does not match package.json', () => {
  assert.throws(
    () => releaseVersionForPackage('0.1.0', 'tag', 'v1.0.0'),
    /must match package\.json version/,
  )
})

test('allows an untagged manual candidate for the package version', () => {
  assert.equal(releaseVersionForPackage('0.1.0', undefined, undefined), '0.1.0')
})

test('rejects invalid package versions', () => {
  assert.throws(() => releaseVersionForPackage('v1', 'tag', 'vv1'), /semantic version/)
})

test('keeps package and lockfile versions aligned', () => {
  assert.equal(packageLock.version, packageJson.version)
  assert.equal(packageLock.packages[''].version, packageJson.version)
})

test('documents the package version in the changelog', () => {
  assert.match(changelog, new RegExp(`^## ${packageJson.version.replaceAll('.', '\\.')}(?: - .+)?$`, 'm'))
})
