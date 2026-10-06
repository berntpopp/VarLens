import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import {
  TranscriptIdSchema,
  TranscriptInsertRowSchema,
  TranscriptVariantIdSchema
} from '../../../shared/api/schemas/transcripts'
import { mainLogger } from '../../services/MainLogger'

/**
 * Transcript IPC handlers
 *
 * Channels: transcripts:list, transcripts:switch, transcripts:insertAndSwitch
 */
export function registerTranscriptHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  /**
   * List all transcripts for a variant
   */
  ipcMain.handle('transcripts:list', async (_event, variantId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = TranscriptVariantIdSchema.safeParse(variantId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid transcripts:list params: ${validated.error.message}`,
          'transcripts'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({
          type: 'transcripts:list',
          params: [validated.data]
        })
      }

      const pool = getDbPool?.()
      if (pool !== undefined && pool !== null) {
        return await pool.run({ type: 'transcripts:list' as const, params: [validated.data] })
      }
      const db = getDb()
      return db.transcripts.getVariantTranscripts(validated.data)
    })
  })

  /**
   * Switch the selected transcript for a variant
   */
  ipcMain.handle(
    'transcripts:switch',
    async (_event, variantId: unknown, transcriptId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
        if (!validatedVariantId.success) {
          mainLogger.error(
            `Invalid transcripts:switch variantId: ${validatedVariantId.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const validatedTranscriptId = TranscriptIdSchema.safeParse(transcriptId)
        if (!validatedTranscriptId.success) {
          mainLogger.error(
            `Invalid transcripts:switch transcriptId: ${validatedTranscriptId.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        return await session.getWriteExecutor().execute({
          type: 'transcripts:switch',
          params: [validatedVariantId.data, validatedTranscriptId.data]
        })
      })
    }
  )

  /**
   * Insert a transcript (if not present) and switch to it.
   * Used when selecting a VEP-only transcript that isn't in the DB yet.
   */
  ipcMain.handle(
    'transcripts:insertAndSwitch',
    async (_event, variantId: unknown, transcript: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
        if (!validatedVariantId.success) {
          mainLogger.error(
            `Invalid transcripts:insertAndSwitch variantId: ${validatedVariantId.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const validatedTranscript = TranscriptInsertRowSchema.safeParse(transcript)
        if (!validatedTranscript.success) {
          mainLogger.error(
            `Invalid transcripts:insertAndSwitch transcript: ${validatedTranscript.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        return await session.getWriteExecutor().execute({
          type: 'transcripts:insertAndSwitch',
          params: [validatedVariantId.data, validatedTranscript.data as TranscriptInsertRow]
        })
      })
    }
  )
}
