/**
 * Electron window `close` is intercepted so the renderer can confirm unsaved work.
 * After the renderer confirms, the next `close` must proceed so `app.quit()` can
 * finish. Reset exists so a later window never inherits a confirmed-close flag.
 */
export class WindowCloseGuard {
  private confirmed = false

  get shouldPrompt(): boolean {
    return !this.confirmed
  }

  confirm(): void {
    this.confirmed = true
  }

  reset(): void {
    this.confirmed = false
  }
}
