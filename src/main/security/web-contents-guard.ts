/**
 * Global `web-contents-created` security guard.
 *
 * Defense-in-depth for ANY webContents the app might create now or in the
 * future (a devtools window, an accidental `<webview>` guest page, a future
 * secondary BrowserWindow) — those would otherwise inherit Electron's
 * permissive defaults.
 *
 * Scope: webview hardening only. If anything ever attaches a `<webview>` tag,
 * its `webPreferences` are stripped of `preload` and forced to
 * `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — the
 * same posture the main window uses — before the guest page loads. A guest
 * page with no preload and no node integration cannot reach the `window.api`
 * bridge regardless of where it navigates, so this neutralizes the privileged-
 * navigation risk for secondary webContents without needing a navigation gate.
 *
 * Top-level navigation hardening for the MAIN window is deliberately NOT done
 * here. That is finding S2, owned by PR-F (`fix/url-nav-path-hardening`), which
 * tightens `isMainWindowNavigationAllowed` (exact packaged-document match +
 * WHATWG origin comparison) and applies it to the main window's own
 * `will-navigate` in `createWindow()`. Reusing that predicate here would (a)
 * add no security over the pre-existing per-window handler, since it is the
 * same predicate, and (b) couple this module to a function whose signature
 * PR-F changes. This guard stays independent of that work.
 *
 * This guard also does NOT call `setWindowOpenHandler`: the main window owns
 * that path already (deny-by-default + validated `openExternal`).
 */

import { app } from 'electron'

/**
 * Hardens `<webview>` attachment on a single webContents instance. Pure with
 * respect to Electron globals (aside from the passed-in `contents`), so it is
 * testable against a structurally compatible fake without a real Electron
 * runtime.
 */
export function guardWebContents(contents: Electron.WebContents): void {
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
    guardWebContents(contents)
  })
}
