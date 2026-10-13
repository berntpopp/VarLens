/**
 * Quit-time cleanup: hold the quit until the database has closed (queued writes
 * flushed) and ZIP extractions are removed, bounded so a hung worker cannot
 * block quitting (#552, #562).
 */

import { mainLogger } from './services/MainLogger'

/** The slice of Electron's `app` this module needs (keeps it unit-testable). */
export interface QuitApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

export const QUIT_CLEANUP_TIMEOUT_MS = 5_000

/**
 * The first `before-quit` is cancelled, `cleanup` runs, then `app.quit()` is
 * called again; that repeat event (and any other) passes straight through.
 * Also covers electron-updater's quitAndInstall, which spawns the installer
 * first and then calls `app.quit()`.
 */
export function installQuitCleanup(
  app: QuitApp,
  cleanup: () => Promise<void>,
  timeoutMs = QUIT_CLEANUP_TIMEOUT_MS
): void {
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        mainLogger.warn(`Quit cleanup did not finish within ${timeoutMs} ms; quitting`, 'app')
        resolve()
      }, timeoutMs)
    })
    const done = cleanup().catch((e: unknown) => {
      mainLogger.warn(`Quit cleanup failed: ${e instanceof Error ? e.message : String(e)}`, 'app')
    })
    void Promise.race([done, timeout]).finally(() => {
      clearTimeout(timer)
      app.quit()
    })
  })
}
