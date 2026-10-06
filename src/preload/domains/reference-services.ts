import { ipcRenderer } from 'electron'
import {
  REFERENCE_SERVICES_CHANNELS,
  type ReferenceServicesApi
} from '../../shared/ipc/domains/reference-services'

export function createReferenceServicesApi(): ReferenceServicesApi {
  return {
    status: () => ipcRenderer.invoke(REFERENCE_SERVICES_CHANNELS.status),
    setPolicy: (update) => ipcRenderer.invoke(REFERENCE_SERVICES_CHANNELS.setPolicy, update)
  }
}
