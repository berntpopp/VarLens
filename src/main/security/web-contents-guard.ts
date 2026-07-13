/**
 * Global `web-contents-created` security guard.
 *
 * Defense-in-depth for ANY webContents the app might create now or in the
 * future (a devtools window, an accidental `<webview>` guest page, a future
 * secondary BrowserWindow) — those would otherwise inherit Electron's
 * permissive defaults.
 *
 * Every webContents receives a fail-closed `will-navigate` handler using an
 * injected app navigation policy. Keeping the policy outside this module lets
 * the main window and future secondary contents share the same decision while
 * allowing that policy to evolve independently.
 *
 * If anything ever attaches a `<webview>` tag, its `webPreferences` are also
 * stripped of `preload` and forced to `nodeIntegration: false`,
 * `contextIsolation: true`, `sandbox: true` before the guest page loads.
 *
 * This guard also does NOT call `setWindowOpenHandler`: the main window owns
 * that path already (deny-by-default + validated `openExternal`).
 */

import { app } from 'electron'

export type NavigationAllowPredicate = (url: string) => boolean

/**
 * Hardens navigation and `<webview>` attachment on one webContents instance.
 * Pure with respect to Electron globals (aside from the passed-in `contents`),
 * so it is testable against a structurally compatible fake.
 */
export function guardWebContents(
  contents: Electron.WebContents,
  isNavigationAllowed: NavigationAllowPredicate
): void {
  contents.on('will-navigate', (event, url) => {
    let allowed = false
    try {
      allowed = isNavigationAllowed(url)
    } catch {
      // A policy failure must not turn into a fail-open navigation path.
    }
    if (!allowed) event.preventDefault()
  })

  contents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
  })
}

/**
 * Registers the global guard for every webContents created for the lifetime
 * of the app (main window, any future secondary windows, devtools, etc.).
 * Call once, early in `app.whenReady()` — before `createWindow()` — so the
 * listener is in place before the first webContents is created.
 */
export function installWebContentsSecurityGuards(
  isNavigationAllowed: NavigationAllowPredicate
): void {
  app.on('web-contents-created', (_event, contents) => {
    guardWebContents(contents, isNavigationAllowed)
  })
}
