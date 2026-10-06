import { app } from 'electron'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import { z } from 'zod'
import type { HandlerDependencies } from '../types'
import { setWorkerThreads, getWorkerThreads } from '../dbPoolManager'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import { mainLogger } from '../../services/MainLogger'
import { getMainPerfSnapshot } from '../../services/MainPerfTrace'
import { computeCapabilityDocument } from '../../../shared/ipc/capability-document'
import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'

/**
 * System IPC handlers
 * Channels: system:version, system:userDataPath, system:getCpuCount,
 *           system:setWorkerThreads, system:getWorkerThreads, system:capabilities
 */

const SetWorkerThreadsCountSchema = z.number().int().min(0).max(64)

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

/** Storage capabilities of the open session, or null before a database is open. */
function currentStorageCapabilities(
  getDbManager: HandlerDependencies['getDbManager']
): StorageCapabilities | null {
  return getDbManager().getCurrentSessionOrNull()?.capabilities ?? null
}

export function registerSystemHandlers({ ipcMain, getDbManager }: HandlerDependencies): void {
  // Desktop capability document: the local user owns the workspace (admin role)
  // and every manifest method is reachable; storage flags come from the session.
  ipcMain.handle('system:capabilities', async () => {
    return wrapHandler(async () =>
      computeCapabilityDocument({
        runtime: 'desktop',
        role: 'admin',
        storage: currentStorageCapabilities(getDbManager)
      })
    )
  })

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
      const parsed = SetWorkerThreadsCountSchema.safeParse(count)
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid system:setWorkerThreads count: ${parsed.error.message}`
        )
      }

      setWorkerThreads(parsed.data)
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

  ipcMain.handle('perf:mainSnapshot', async () => {
    return wrapHandler(async () => {
      return getMainPerfSnapshot()
    })
  })
}
