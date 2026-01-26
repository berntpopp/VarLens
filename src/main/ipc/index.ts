/**
 * Register all IPC handlers.
 * Called once during app initialization.
 *
 * Handler modules self-register via ipcMain.handle() on import.
 */
export function registerIpcHandlers(): void {
  // Import handler modules - they register themselves as side effect
  import('./handlers/cases')
  import('./handlers/variants')
  import('./handlers/import')
  import('./handlers/system')

  console.log('IPC handlers registered')
}
