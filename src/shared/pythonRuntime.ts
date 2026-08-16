export interface PythonProjectResult {
  ok: boolean
  resultJson: string
  stdout: string
  stderr: string
  error: string
  hostError: string
  durationMs: number
}

export interface PythonProjectFileInput {
  path: string
  source: string
}

export interface PythonProjectPackageInput {
  entryPath: string
  files: PythonProjectFileInput[]
}

export interface PythonArtifact {
  path: string
  content: string
  encoding?: 'utf-8'
}

export interface PythonArtifactExportResult {
  directory: string
  written: number
}
