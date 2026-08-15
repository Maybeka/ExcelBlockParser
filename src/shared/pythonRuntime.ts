export interface PythonProjectResult {
  ok: boolean
  resultJson: string
  stdout: string
  stderr: string
  error: string
  hostError: string
  durationMs: number
}
