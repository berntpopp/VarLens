import type { HandlerDependencies } from '../types'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus
} from '../../services/AutoUpdater'

/**
 * Updater IPC handlers
 * Channels: updater:check, updater:download, updater:install, updater:status
 */
export function registerUpdaterHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('updater:check', async () => {
    await checkForUpdates()
  })

  ipcMain.handle('updater:download', async () => {
    await downloadUpdate()
  })

  ipcMain.handle('updater:install', async () => {
    installUpdate()
  })

  ipcMain.handle('updater:status', async () => {
    return getUpdateStatus()
  })
}
