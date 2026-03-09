import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'

/**
 * Transcript IPC handlers
 *
 * Channels: transcripts:list, transcripts:switch, transcripts:insertAndSwitch
 */

/**
 * List all transcripts for a variant
 */
ipcMain.handle('transcripts:list', async (_event, variantId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    return db.transcripts.getVariantTranscripts(variantId)
  })
})

/**
 * Switch the selected transcript for a variant
 */
ipcMain.handle('transcripts:switch', async (_event, variantId: number, transcriptId: string) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.transcripts.switchSelectedTranscript(variantId, transcriptId)
    return { success: true }
  })
})

/**
 * Insert a transcript (if not present) and switch to it.
 * Used when selecting a VEP-only transcript that isn't in the DB yet.
 */
ipcMain.handle(
  'transcripts:insertAndSwitch',
  async (_event, variantId: number, transcript: TranscriptInsertRow) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      db.transcripts.insertTranscriptAndSwitch(variantId, transcript)
      return { success: true }
    })
  }
)
