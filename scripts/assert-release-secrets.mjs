const platform = process.argv[2]

const required = platform === 'macOS'
  ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_TEAM_ID']
  : platform === 'Windows'
    ? ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']
    : []

const missing = required.filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`Release signing is not configured for ${platform}: missing ${missing.join(', ')}`)
  process.exit(1)
}
