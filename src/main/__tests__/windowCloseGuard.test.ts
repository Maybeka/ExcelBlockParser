import { describe, expect, it } from 'vitest'
import { WindowCloseGuard } from '../windowCloseGuard'

describe('window close confirmation guard', () => {
  it('prompts until the renderer confirms the close', () => {
    const guard = new WindowCloseGuard()
    expect(guard.shouldPrompt).toBe(true)
    guard.confirm()
    expect(guard.shouldPrompt).toBe(false)
  })

  it('prompts again after a confirmed close is reset for a new window', () => {
    const guard = new WindowCloseGuard()
    guard.confirm()
    guard.reset()
    expect(guard.shouldPrompt).toBe(true)
  })
})
