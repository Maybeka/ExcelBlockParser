import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareRelease } from './prepare-pywebview-release.mjs'

test('publishes only the exact verified executable and matching source version', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-release-'))
  try {
    mkdirSync(join(root, 'release-pywebview'))
    mkdirSync(join(root, '.tmp/pywebview-downloaded-distribution'), { recursive: true })
    const binary = Buffer.from('tested executable')
    const sha256 = createHash('sha256').update(binary).digest('hex')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.9.0' }))
    writeFileSync(join(root, 'release-pywebview/build-manifest.json'), JSON.stringify({ version: '1.9.0', sourceCommit: 'commit' }))
    writeFileSync(join(root, 'release-pywebview/Excel Block Parser.exe'), binary)
    const evidence = join(root, '.tmp/pywebview-downloaded-distribution/distribution.result.json')
    writeFileSync(evidence, JSON.stringify({ completed: true, singleFile: true, executableSha256: sha256 }))
    assert.throws(() => prepareRelease(root, { GITHUB_SHA: 'other' }), /provenance/)
    assert.throws(() => prepareRelease(root, { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v2.0.0' }), /must match/)
    const result = prepareRelease(root, { GITHUB_SHA: 'commit' })
    assert.deepEqual(readFileSync(join(root, 'release-pywebview/assets', result.name)), binary)
    assert.equal(result.sha256, sha256)
    writeFileSync(join(root, 'release-pywebview/Excel Block Parser.exe'), 'rebuilt different executable')
    assert.throws(() => prepareRelease(root, {}), /identical/)
    writeFileSync(evidence, JSON.stringify({ completed: false, singleFile: true, executableSha256: sha256 }))
    assert.throws(() => prepareRelease(root, {}), /identical/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
