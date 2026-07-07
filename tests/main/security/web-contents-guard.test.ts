import { describe, it, expect, vi, beforeEach } from 'vitest'
import { guardWebContents } from '../../../src/main/security/web-contents-guard'

vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

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
    guardWebContents(contents, 'http://localhost:5173')
  })

  describe('will-navigate', () => {
    it('prevents navigation to a disallowed URL', () => {
      const event = { preventDefault: vi.fn() }
      handlers['will-navigate'](event, 'https://evil.example')
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
    })

    it('does not prevent navigation to an allowed app-doc URL', () => {
      // isMainWindowNavigationAllowed() permits any `file://` URL
      // unconditionally (see src/main/window-navigation-policy.ts).
      const event = { preventDefault: vi.fn() }
      handlers['will-navigate'](event, 'file:///app/out/renderer/index.html')
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('does not prevent navigation to the allowed dev renderer origin', () => {
      const event = { preventDefault: vi.fn() }
      handlers['will-navigate'](event, 'http://localhost:5173/some-route')
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
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
  })
})
