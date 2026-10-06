import type { IpcMain } from 'electron'
import {
  REFERENCE_SERVICES_CHANNELS,
  buildReferenceServicesStatus,
  uniformReferenceServicePolicy
} from '../../../shared/ipc/domains/reference-services'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'

/**
 * Desktop has no egress policy: the app runs on the user's machine and every
 * external lookup stays available exactly as before. The status channel lets
 * the shared renderer gate features the same way in both runtimes; the
 * policy itself is a web-server instance setting.
 */
export function registerReferenceServicesDomain(ipcMain: IpcMain): void {
  ipcMain.handle(REFERENCE_SERVICES_CHANNELS.status, async () =>
    wrapHandler(async () =>
      buildReferenceServicesStatus('desktop', uniformReferenceServicePolicy(true))
    )
  )

  ipcMain.handle(REFERENCE_SERVICES_CHANNELS.setPolicy, async () =>
    wrapHandler(async () => {
      throw new InvalidParametersError(
        'reference-services:setPolicy is a web-server setting',
        'External lookups are always available in the desktop app.'
      )
    })
  )
}
