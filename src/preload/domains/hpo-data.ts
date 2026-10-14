import { ipcRenderer } from 'electron'
import { HPO_DATA_CHANNELS, type HpoDataApi } from '../../shared/ipc/domains/hpo-data'

export function createHpoDataApi(): HpoDataApi {
  return {
    status: () => ipcRenderer.invoke(HPO_DATA_CHANNELS.status),
    update: () => ipcRenderer.invoke(HPO_DATA_CHANNELS.update)
  }
}
