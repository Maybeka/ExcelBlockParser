export interface PythonDebugResult {
  ok: boolean
  repr: string
  stdout: string
  stderr: string
  error: string
  hostError: string
  durationMs: number
}
