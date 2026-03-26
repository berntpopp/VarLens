import type { HandlerDependencies } from '../types'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus
} from '../../services/AutoUpdater'
import { wrapHandler } from '../errorHandler'

/**
 * Updater IPC handlers
 * Channels: updater:check, updater:download, updater:install, updater:status
 */
export function registerUpdaterHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('updater:check', async () => {
    return wrapHandler(async () => {
      await checkForUpdates()
    })
  })

  ipcMain.handle('updater:download', async () => {
    return wrapHandler(async () => {
      await downloadUpdate()
    })
  })

  ipcMain.handle('updater:install', async () => {
    return wrapHandler(async () => {
      installUpdate()
    })
  })

  ipcMain.handle('updater:status', async () => {
    return wrapHandler(async () => {
      return getUpdateStatus()
    })
  })
}
