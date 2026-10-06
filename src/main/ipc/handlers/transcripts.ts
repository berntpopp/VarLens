import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { createTranscriptsHandlers, type TranscriptsHandlers } from './transcripts-logic'

/**
 * Transcript IPC handlers (spec §4.1, Limin L1).
 *
 * Mounts the shared transcripts handler factory onto Electron ipcMain.
 * Channels: transcripts:list, transcripts:switch, transcripts:insertAndSwitch
 */
export function registerTranscriptHandlers({
  ipcMain,
  getDbManager
}: Pick<HandlerDependencies, 'ipcMain' | 'getDbManager'> & Partial<HandlerDependencies>): void {
  const getHandlers = (): TranscriptsHandlers =>
    createTranscriptsHandlers({
      getSession: () => getDbManager().getCurrentSession()
    })

  ipcMain.handle('transcripts:list', async (_event, variantId: unknown) => {
    return wrapHandler(() => getHandlers().list(variantId as number))
  })

  ipcMain.handle(
    'transcripts:switch',
    async (_event, variantId: unknown, transcriptId: unknown) => {
      return wrapHandler(() => getHandlers().switch(variantId as number, transcriptId as string))
    }
  )

  ipcMain.handle(
    'transcripts:insertAndSwitch',
    async (_event, variantId: unknown, transcript: unknown) => {
      return wrapHandler(() =>
        getHandlers().insertAndSwitch(variantId as number, transcript as TranscriptInsertRow)
      )
    }
  )
}
