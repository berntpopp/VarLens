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
  let isNavigationAllowed: ReturnType<typeof vi.fn<(url: string) => boolean>>

  beforeEach(() => {
    const fake = createFakeWebContents()
    contents = fake.contents
    handlers = fake.handlers
    isNavigationAllowed = vi.fn<(url: string) => boolean>(() => false)
    guardWebContents(contents, isNavigationAllowed)
  })

  describe('will-navigate', () => {
    it('denies arbitrary navigation on a synthetic secondary webContents', () => {
      const event = { preventDefault: vi.fn() }
      const arbitraryUrl = 'https://attacker.example/escape'

      expect(handlers['will-navigate']).toBeDefined()
      handlers['will-navigate'](event, arbitraryUrl)

      expect(isNavigationAllowed).toHaveBeenCalledWith(arbitraryUrl)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    })

    it('allows navigation accepted by the injected app policy', () => {
      const event = { preventDefault: vi.fn() }
      const appUrl = 'file:///app/renderer/index.html'
      isNavigationAllowed.mockReturnValue(true)

      handlers['will-navigate'](event, appUrl)

      expect(isNavigationAllowed).toHaveBeenCalledWith(appUrl)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('fails closed when the injected app policy throws', () => {
      const event = { preventDefault: vi.fn() }
      isNavigationAllowed.mockImplementation(() => {
        throw new Error('policy unavailable')
      })

      expect(() =>
        handlers['will-navigate'](event, 'https://attacker.example/escape')
      ).not.toThrow()
      expect(event.preventDefault).toHaveBeenCalledOnce()
    })
  })

  describe('will-redirect', () => {
    it('denies a server redirect to an arbitrary destination', () => {
      const event = { preventDefault: vi.fn() }
      const arbitraryUrl = 'https://attacker.example/redirect-target'

      expect(handlers['will-redirect']).toBeDefined()
      handlers['will-redirect'](event, arbitraryUrl)

      expect(isNavigationAllowed).toHaveBeenCalledWith(arbitraryUrl)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    })

    it('allows a redirect accepted by the injected app policy', () => {
      const event = { preventDefault: vi.fn() }
      const appUrl = 'http://localhost:5173/'
      isNavigationAllowed.mockReturnValue(true)

      handlers['will-redirect'](event, appUrl)

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
