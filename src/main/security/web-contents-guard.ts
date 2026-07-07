/**
 * Global `web-contents-created` security guard.
 *
 * The main window already installs its own `will-navigate` and
 * `setWindowOpenHandler` listeners in `createWindow()` (see
 * `src/main/index.ts`). This module is defense-in-depth for ANY OTHER
 * webContents the app might create now or in the future (e.g. a devtools
 * window, an accidental `<webview>` guest page, a future secondary
 * BrowserWindow) — those would otherwise inherit Electron's permissive
 * defaults instead of VarLens's navigation policy.
 *
 * Two behaviors, deliberately narrow in scope:
 *
 * 1. Deny-by-default navigation. Every webContents gets a `will-navigate`
 *    listener that reuses the SAME allow-check as the main window
 *    (`isMainWindowNavigationAllowed`), so legitimate app-document and
 *    dev-server navigations keep working while everything else is blocked.
 * 2. Webview hardening. If anything ever attaches a `<webview>` tag, its
 *    `webPreferences` are stripped of `preload` and forced to
 *    `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` —
 *    the same posture the main window itself uses — before the guest page
 *    loads.
 *
 * This guard intentionally does NOT call `setWindowOpenHandler`: the main
 * window owns that path already, and overriding it here would risk
 * conflicting with that handler.
 */

import { app } from 'electron'
import { isMainWindowNavigationAllowed } from '../window-navigation-policy'
import { mainLogger } from '../services/MainLogger'

/**
 * Attaches the deny-by-default navigation guard and webview hardening to a
 * single webContents instance. Pure with respect to Electron globals (aside
 * from the passed-in `contents`), so it is testable against a structurally
 * compatible fake without a real Electron runtime.
 */
export function guardWebContents(
  contents: Electron.WebContents,
  rendererUrl: string | undefined
): void {
  contents.on('will-navigate', (event, url) => {
    if (!isMainWindowNavigationAllowed(url, rendererUrl)) {
      mainLogger.warn(`Blocked navigation to disallowed URL: ${url}`, 'web-contents-guard')
      event.preventDefault()
    }
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
export function installWebContentsSecurityGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    guardWebContents(contents, process.env['ELECTRON_RENDERER_URL'])
  })
}
