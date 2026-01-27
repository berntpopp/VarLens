import { ipcMain, app } from 'electron'

/**
 * System IPC handlers
 * Channels: system:version, system:userDataPath
 */

ipcMain.handle('system:version', async () => {
  return { app: app.getVersion(), electron: process.versions.electron }
})

ipcMain.handle('system:userDataPath', async () => {
  return app.getPath('userData')
})
