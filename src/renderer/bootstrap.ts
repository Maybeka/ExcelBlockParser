// Wait for the native API before importing modules that capture the bridge singleton.
async function start() {
  if (new URLSearchParams(location.search).get('desktop') === 'pywebview') {
    await import('./services/pywebviewBootstrap').then(module => module.initializePywebview())
  }
  await import('./main')
}

void start().catch(error => {
  console.error(error)
  document.getElementById('root')!.textContent = String(error)
})
