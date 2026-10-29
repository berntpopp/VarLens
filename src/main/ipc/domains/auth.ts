import type { IpcMain } from 'electron'
import { getDatabaseService, getDatabaseManager } from '../../database'
import { getDesktopAuth } from '../../auth/desktop-auth'
import { registerAuthHandlers } from '../handlers/auth'
import { registerDesktopAuthHandlers } from '../handlers/desktop-auth'

export function registerAuthDomain(ipcMain: IpcMain): void {
  registerAuthHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbManager: getDatabaseManager
  })
  registerDesktopAuthHandlers(ipcMain, getDesktopAuth)
}
