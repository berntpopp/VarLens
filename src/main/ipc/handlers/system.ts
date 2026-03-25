import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import type { HandlerDependencies } from '../types'
import { setWorkerThreads, getWorkerThreads } from '../dbPoolManager'

/**
 * System IPC handlers
 * Channels: system:version, system:userDataPath
 */

/**
 * Get the application version from package.json.
 * In non-packaged (dev) mode, app.getVersion() returns the Electron version
 * instead of the app version, so we read package.json directly as fallback.
 */
function getAppVersion(): string {
  const electronVersion = process.versions.electron
  const reportedVersion = app.getVersion()
  if (reportedVersion === electronVersion) {
    try {
      // In dev mode, app.getAppPath() points to out/main — walk up to find package.json
      let dir = app.getAppPath()
      for (let i = 0; i < 5; i++) {
        const pkgPath = join(dir, 'package.json')
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
          if (typeof pkg.version === 'string') return pkg.version
        }
        dir = dirname(dir)
      }
      return reportedVersion
    } catch {
      return reportedVersion
    }
  }
  return reportedVersion
}

export function registerSystemHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('system:version', async () => {
    return { app: getAppVersion(), electron: process.versions.electron }
  })

  ipcMain.handle('system:userDataPath', async () => {
    return app.getPath('userData')
  })

  ipcMain.handle('system:getCpuCount', () => {
    return os.cpus().length
  })

  ipcMain.handle('system:setWorkerThreads', (_event, count: number) => {
    setWorkerThreads(count)
  })

  ipcMain.handle('system:getWorkerThreads', () => {
    return getWorkerThreads()
  })
}
