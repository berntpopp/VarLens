import type { IpcMain } from 'electron'
import type { DesktopAuthStatus } from '../../../shared/auth/desktop-auth-status'
import type { DesktopAuth } from '../../auth/desktop-auth'
import { wrapHandler } from '../errorHandler'

/**
 * Desktop sign-in IPC handlers (#295)
 * Channels: auth:desktopStatus
 *
 * Answers without a session (CHANNELS_WITHOUT_SESSION): the renderer needs
 * the state to choose between the app and the sign-in screen.
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
}
