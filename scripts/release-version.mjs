const packageVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function releaseVersionForPackage(packageVersion, refType, refName) {
  if (typeof packageVersion !== 'string' || !packageVersionPattern.test(packageVersion)) {
    throw new Error(`package.json version must be a semantic version, received ${JSON.stringify(packageVersion)}.`)
  }

  if (refType === 'tag') {
    const expectedTag = `v${packageVersion}`
    if (refName !== expectedTag) {
      throw new Error(`Release tag ${JSON.stringify(refName)} must match package.json version ${JSON.stringify(expectedTag)}.`)
    }
  }

  return packageVersion
}
