import type { IpcMain } from 'electron'
import { HPO_DATA_CHANNELS } from '../../../shared/ipc/domains/hpo-data'
import type { HpoDataUpdateResult } from '../../../shared/types/hpo-data'
import { apiFetch } from '../../services/api/http-fetch'
import { networkStatus } from '../../services/network/NetworkStatus'
import { runHpoBuild } from '../../services/phenotype/hpo-build-worker-client'
import { updateHpoData } from '../../services/phenotype/hpo-data-update'
import { readHpoDataStatus, resolveHpoDbPath } from '../../services/phenotype/hpo-similarity-db'
import { mainLogger } from '../../services/MainLogger'
import { wrapHandler } from '../errorHandler'

let updating: Promise<HpoDataUpdateResult> | null = null

export function registerHpoDataDomain(ipcMain: IpcMain): void {
  ipcMain.handle(HPO_DATA_CHANNELS.status, async () => wrapHandler(async () => readHpoDataStatus()))

  ipcMain.handle(HPO_DATA_CHANNELS.update, async () =>
    wrapHandler(async () => {
      const dbPath = resolveHpoDbPath()
      if (dbPath === null) throw new Error('HPO data location is not configured')
      // One update at a time: both would write the same `<db>.tmp`.
      updating ??= updateHpoData({
        fetch: apiFetch,
        isOnline: () => networkStatus.getStatus(),
        dbPath,
        build: runHpoBuild
      }).finally(() => (updating = null))
      const result = await updating
      mainLogger.info(result.message, 'hpo-data')
      return result
    })
  )
}
