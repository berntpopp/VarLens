/**
 * The `ipcMain` objects the IPC domains register through.
 *
 * Both ask the access gate on every call. Only `startupGated` also waits for
 * the database startup gate: the data domains are registered before the
 * default database opens, so their invokes hold until startup settles. The
 * `jobs` and `debug` domains answer without that wait, through `accessOnly`;
 * without a sign-in mode the access gate lets every call through.
 */
import type { IpcMain } from 'electron'
import { gateIpcMainOnAccess } from '../auth/access-gate'
import { gateIpcMainOnDatabaseStartup } from '../database/startup-gate'

export interface IpcRegistrars {
  readonly startupGated: IpcMain
  readonly accessOnly: IpcMain
}

export function createIpcRegistrars(ipcMain: IpcMain): IpcRegistrars {
  return {
    startupGated: gateIpcMainOnAccess(gateIpcMainOnDatabaseStartup(ipcMain)),
    accessOnly: gateIpcMainOnAccess(ipcMain)
  }
}
