import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersionForPackage } from './release-version.mjs'

export function prepareRelease(root, environment = process.env) {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const version = releaseVersionForPackage(packageJson.version, environment.GITHUB_REF_TYPE, environment.GITHUB_REF_NAME)
  const directory = resolve(root, 'release-pywebview/assets')
  const manifest = JSON.parse(readFileSync(resolve(root, 'release-pywebview/build-manifest.json'), 'utf8'))
  if (manifest.version !== version || (environment.GITHUB_SHA && manifest.sourceCommit !== environment.GITHUB_SHA)) {
    throw new Error('Build provenance must match the release source commit and package version')
}
const executable = readFileSync(resolve(root, 'release-pywebview/Excel Block Parser.exe'))
const name = `ExcelBlockParser-${version}-windows-x64.exe`
const sha256 = createHash('sha256').update(executable).digest('hex')
const verification = JSON.parse(readFileSync(resolve(root, '.tmp/pywebview-downloaded-distribution/distribution.result.json'), 'utf8'))
if (verification.completed !== true || verification.singleFile !== true || verification.executableSha256 !== sha256) {
  throw new Error('The release executable must be identical to the verified downloaded executable')
}
mkdirSync(directory, { recursive: true })
copyFileSync(resolve(root, 'release-pywebview/Excel Block Parser.exe'), resolve(directory, name))
writeFileSync(resolve(directory, 'SHA256SUMS.txt'), `${sha256}  ${name}\n`)
writeFileSync(resolve(directory, 'build-manifest.json'), JSON.stringify({ ...manifest, artifact: name, sha256 }, null, 2) + '\n')
console.log(`Prepared verified executable without rebuilding: ${name}`)
return { name, sha256 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prepareRelease(fileURLToPath(new URL('..', import.meta.url)))
