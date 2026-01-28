/**
 * Register all IPC handlers.
 * Called once during app initialization.
 *
 * Handler modules self-register via ipcMain.handle() on import.
 */
export async function registerIpcHandlers(): Promise<void> {
  // Import handler modules - they register themselves as side effect
  await Promise.all([
    import('./handlers/cases'),
    import('./handlers/variants'),
    import('./handlers/import'),
    import('./handlers/system'),
    import('./handlers/export'),
    import('./handlers/shell'),
    import('./handlers/database'),
    import('./handlers/batch-import'),
    import('./handlers/cohort'),
    import('./handlers/annotations'),
    import('./handlers/vep'),
    import('./handlers/hpo'),
    import('./handlers/case-metadata')
  ])

  console.log('IPC handlers registered')
}
