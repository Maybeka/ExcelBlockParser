import type { DesktopHostAPI } from './bridge'

export type PywebviewAPI = DesktopHostAPI & {
  Ready: () => Promise<void>
  Minimize: () => Promise<void>
  ToggleMaximize: () => Promise<boolean>
  LoadAppLocale: () => Promise<string | null>
  SaveAppLocale: (locale: string) => Promise<void>
  RuntimeInfo: () => Promise<{ pywebview: string; hostPython: string; scriptPython: string; mathType: string }>
}

declare global {
  interface Window {
    pywebview?: { api: PywebviewAPI; runtimeInfo?: Awaited<ReturnType<PywebviewAPI['RuntimeInfo']>> }
  }
}

export async function initializePywebview() {
  const ready = () => ['RuntimeInfo', 'Ready', 'Minimize', 'ToggleMaximize', 'LoadAppLocale', 'SaveAppLocale'].every(
    method => typeof window.pywebview?.api?.[method as keyof PywebviewAPI] === 'function',
  )
  if (!ready()) {
    await new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        if (!ready()) return
        clearTimeout(timeout)
        window.removeEventListener('pywebviewready', checkReady)
        resolve()
      }
      const timeout = setTimeout(() => {
        window.removeEventListener('pywebviewready', checkReady)
        reject(new Error('pywebview bridge initialization timed out'))
      }, 15000)
      window.addEventListener('pywebviewready', checkReady)
      checkReady()
    })
  }
  const api = window.pywebview!.api
  const locale = await api.LoadAppLocale()
  if (locale === 'en-US' || locale === 'zh-CN') localStorage.setItem('excel-block-parser.locale', locale)
  window.pywebview!.runtimeInfo = await api.RuntimeInfo()
  window.desktopEvents = {
    EventsOn: (event, callback) => {
      const listener = (value: Event) => {
        const detail = (value as CustomEvent<{ event: string; args: unknown[] }>).detail
        if (detail.event === event) callback(...detail.args)
      }
      window.addEventListener('desktop-event', listener)
      return () => window.removeEventListener('desktop-event', listener)
    },
  }
  await api.Ready()
}

let localeSave = Promise.resolve()

export function persistPywebviewLocale(locale: string): Promise<void> {
  const api = window.pywebview?.api
  if (!api) return Promise.resolve()
  // Native RPCs use separate threads; preserve rapid settings changes in order.
  localeSave = localeSave.catch(() => {}).then(() => api.SaveAppLocale(locale))
  return localeSave
}
