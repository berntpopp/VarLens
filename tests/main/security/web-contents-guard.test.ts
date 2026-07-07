import { describe, it, expect, vi, beforeEach } from 'vitest'
import { guardWebContents } from '../../../src/main/security/web-contents-guard'

/**
 * Minimal structurally-compatible stand-in for `Electron.WebContents`. The
 * guard only calls `.on(event, handler)`, so this fake captures registered
 * handlers by event name without requiring a real Electron runtime.
 */
type FakeHandler = (...args: unknown[]) => void

function createFakeWebContents(): {
  contents: Electron.WebContents
  handlers: Record<string, FakeHandler>
} {
  const handlers: Record<string, FakeHandler> = {}
  const on = (event: string, handler: FakeHandler): void => {
    handlers[event] = handler
  }
  return { contents: { on } as unknown as Electron.WebContents, handlers }
}

describe('guardWebContents', () => {
  let contents: Electron.WebContents
  let handlers: Record<string, FakeHandler>

  beforeEach(() => {
    const fake = createFakeWebContents()
    contents = fake.contents
    handlers = fake.handlers
    guardWebContents(contents)
  })

  describe('will-attach-webview', () => {
    it('strips preload and forces safe webview preferences', () => {
      const event = { preventDefault: vi.fn() }
      const webPreferences: Record<string, unknown> = {
        preload: '/some/malicious/preload.js',
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
      handlers['will-attach-webview'](event, webPreferences, {})

      expect(webPreferences.preload).toBeUndefined()
      expect('preload' in webPreferences).toBe(false)
      expect(webPreferences.nodeIntegration).toBe(false)
      expect(webPreferences.contextIsolation).toBe(true)
      expect(webPreferences.sandbox).toBe(true)
    })

    it('does not register a will-navigate handler (top-level nav is S2/PR-F scope)', () => {
      // The guard is intentionally webview-only; it must not reuse the
      // main window's navigation predicate. See web-contents-guard.ts.
      expect(handlers['will-navigate']).toBeUndefined()
    })
  })
})
