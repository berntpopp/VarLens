import { ipcMain as electronIpcMain, type IpcMain } from 'electron'
import { DEBUG_CHANNELS } from '../../../shared/ipc/domains/debug'
import { getCounters, resetCounters } from '../../storage/postgres/query-counters'
import { wrapHandler } from '../errorHandler'

function isEnabled(): boolean {
  return process.env.VARLENS_DEBUG_QUERY_COUNTERS === '1'
}

export function registerDebugHandlers(ipcMain: IpcMain = electronIpcMain): void {
  ipcMain.handle(DEBUG_CHANNELS.queryCountersGet, async () =>
    wrapHandler(async () => {
      if (!isEnabled()) return { named: {}, unnamed: 0, enabled: false }
      const c = getCounters()
      return { ...c, enabled: true }
    })
  )
  ipcMain.handle(DEBUG_CHANNELS.queryCountersReset, async () =>
    wrapHandler(async () => {
      if (!isEnabled()) return { enabled: false }
      resetCounters()
      return { enabled: true }
    })
  )
}
