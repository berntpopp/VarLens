/**
 * Startup ordering: show the window, then open the default database.
 *
 * Opening the database runs synchronously on the main thread (schema
 * checks, migrations, key derivation). If it starts before the window has
 * painted, `ready-to-show` cannot be delivered and the user stares at
 * nothing until it finishes. Waiting for the first paint (bounded, so a
 * renderer that never paints cannot stall startup) lets the window and the
 * renderer's lightweight "Opening database…" state appear first.
 */

/** The slice of BrowserWindow this module needs (keeps it unit-testable). */
export interface StartupWindow {
  once(event: 'ready-to-show', listener: () => void): unknown
  isDestroyed(): boolean
}

export interface OpenDefaultDatabaseHooks {
  openDefault: () => Promise<void>
  onOpenFailed: (error: unknown) => void
  /** Always runs once the attempt finished (success or failure). */
  onSettled: () => void
  /** Upper bound for waiting on the first paint. */
  firstPaintTimeoutMs?: number
}

export const FIRST_PAINT_TIMEOUT_MS = 3_000

/** Resolve on the window's first paint, or after `timeoutMs`, whichever is first. */
export function waitForFirstPaint(window: StartupWindow, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (window.isDestroyed()) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, timeoutMs)
    window.once('ready-to-show', () => {
      clearTimeout(timer)
      // Let the `show()` issued by the window's own ready-to-show handler
      // reach the compositor before the main thread goes busy.
      setImmediate(resolve)
    })
  })
}

export async function openDefaultDatabaseAfterWindow(
  window: StartupWindow,
  hooks: OpenDefaultDatabaseHooks
): Promise<void> {
  await waitForFirstPaint(window, hooks.firstPaintTimeoutMs ?? FIRST_PAINT_TIMEOUT_MS)
  try {
    await hooks.openDefault()
  } catch (error) {
    hooks.onOpenFailed(error)
  } finally {
    hooks.onSettled()
  }
}
