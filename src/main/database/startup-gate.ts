/**
 * Startup gate between "window is up" and "database is open".
 *
 * The main window is created and shown before the default database is
 * opened (schema checks, migrations, key derivation can take seconds on an
 * upgrade — audit 05, M-6). IPC handlers are registered before the window
 * exists, so any call that arrives while the database is still opening must
 * wait instead of failing with "DatabaseManager not initialized".
 *
 * The gate defaults to open, so tests and code paths that never call
 * {@link beginDatabaseStartup} behave exactly as before.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

let ready: Promise<void> = Promise.resolve()
let release: (() => void) | null = null

/** Close the gate: IPC handlers registered through it wait until released. */
export function beginDatabaseStartup(): void {
  if (release !== null) return
  ready = new Promise<void>((resolve) => {
    release = resolve
  })
}

/** Open the gate (database opened, or failed and the app runs without one). */
export function completeDatabaseStartup(): void {
  release?.()
  release = null
}

export function whenDatabaseReady(): Promise<void> {
  return ready
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * Wrap `ipcMain` so every `handle(...)` registration first awaits the
 * database startup gate. All other members pass through untouched.
 */
export function gateIpcMainOnDatabaseStartup(ipcMain: IpcMain): IpcMain {
  const handle = (channel: string, listener: InvokeHandler): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      await ready
      return listener(event, ...args)
    })
  }
  return new Proxy(ipcMain, {
    get(target, property, receiver) {
      if (property === 'handle') return handle
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
