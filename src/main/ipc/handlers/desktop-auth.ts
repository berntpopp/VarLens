import type { IpcMain } from 'electron'
import type {
  DesktopAuthStatus,
  DesktopSignInResult
} from '../../../shared/auth/desktop-auth-status'
import type { DesktopAuth } from '../../auth/desktop-auth'
import { wrapHandler } from '../errorHandler'

/**
 * Desktop sign-in IPC handlers (#295)
 * Channels: auth:desktopStatus, auth:desktopSignIn, auth:desktopCancelSignIn,
 *           auth:desktopLock
 *
 * All but auth:desktopLock answer without a session (CHANNELS_WITHOUT_SESSION):
 * the renderer needs the state to choose between the app and the sign-in
 * screen. Without the admin config file there is no sign-in to run or lock.
 */
export function registerDesktopAuthHandlers(
  ipcMain: IpcMain,
  getDesktopAuth: () => DesktopAuth | undefined
): void {
  ipcMain.handle('auth:desktopStatus', async () =>
    wrapHandler(
      async (): Promise<DesktopAuthStatus> => getDesktopAuth()?.status() ?? { mode: 'none' }
    )
  )

  // Waits for the browser, up to the sign-in timeout.
  ipcMain.handle('auth:desktopSignIn', async () =>
    wrapHandler(
      async (): Promise<DesktopSignInResult> =>
        (await getDesktopAuth()?.signIn()) ?? {
          outcome: 'failed',
          message: 'This VarLens has no sign-in configured.'
        }
    )
  )

  ipcMain.handle('auth:desktopCancelSignIn', async () =>
    wrapHandler(async () => {
      getDesktopAuth()?.cancelSignIn()
    })
  )

  ipcMain.handle('auth:desktopLock', async () =>
    wrapHandler(async () => {
      await getDesktopAuth()?.lock('user')
    })
  )
}
