import { app } from 'electron'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import type { HandlerDependencies } from '../types'
import { setWorkerThreads, getWorkerThreads } from '../dbPoolManager'
import { wrapHandler } from '../errorHandler'
import { mainLogger } from '../../services/MainLogger'

/**
 * System IPC handlers
 * Channels: system:version, system:userDataPath, system:getCpuCount,
 *           system:setWorkerThreads, system:getWorkerThreads
 */

/**
 * Get the application version from package.json.
 * In non-packaged (dev) mode, app.getVersion() returns the Electron version
 * instead of the app version, so we read package.json directly as fallback.
 */
async function getAppVersion(): Promise<string> {
  const electronVersion = process.versions.electron
  const reportedVersion = app.getVersion()
  if (reportedVersion === electronVersion) {
    try {
      // In dev mode, app.getAppPath() points to out/main — walk up to find package.json
      let dir = app.getAppPath()
      for (let i = 0; i < 5; i++) {
        const pkgPath = join(dir, 'package.json')
        if (existsSync(pkgPath)) {
          const data = await readFile(pkgPath, 'utf-8')
          const pkg = JSON.parse(data)
          if (typeof pkg.version === 'string') return pkg.version
        }
        dir = dirname(dir)
      }
      return reportedVersion
    } catch (e) {
      mainLogger.warn(
        'Failed to read app version from package.json: ' +
          (e instanceof Error ? e.message : String(e)),
        'system'
      )
      return reportedVersion
    }
  }
  return reportedVersion
}

export function registerSystemHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('system:version', async () => {
    return wrapHandler(async () => {
      return { app: await getAppVersion(), electron: process.versions.electron }
    })
  })

  ipcMain.handle('system:userDataPath', async () => {
    return wrapHandler(async () => {
      return app.getPath('userData')
    })
  })

  ipcMain.handle('system:getCpuCount', async () => {
    return wrapHandler(async () => {
      return os.cpus().length
    })
  })

  ipcMain.handle('system:setWorkerThreads', async (_event, count: number) => {
    return wrapHandler(async () => {
      setWorkerThreads(count)
    })
  })

  ipcMain.handle('system:getWorkerThreads', async () => {
    return wrapHandler(async () => {
      return getWorkerThreads()
    })
  })

  ipcMain.handle('system:logFilePath', async () => {
    return wrapHandler(async () => {
      return mainLogger.getLogFilePath()
    })
  })
}
