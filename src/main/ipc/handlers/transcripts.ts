import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import { mainLogger } from '../../services/MainLogger'

// Schema for variant ID validation
const VariantIdSchema = z.number().int().positive()

// Schema for transcript ID validation
const TranscriptIdSchema = z.string().min(1)

// Schema for transcript insert row validation
const TranscriptInsertRowSchema = z.object({
  transcript_id: z.string().min(1),
  gene_symbol: z.string().nullable(),
  consequence: z.string().nullable(),
  cdna: z.string().nullable(),
  aa_change: z.string().nullable(),
  hpo_sim_score: z.number().nullable(),
  moi: z.string().nullable(),
  is_selected: z.number().int().min(0).max(1)
})

/**
 * Transcript IPC handlers
 *
 * Channels: transcripts:list, transcripts:switch, transcripts:insertAndSwitch
 */
export function registerTranscriptHandlers({
  ipcMain,
  getDb,
  getDbPool
}: HandlerDependencies): void {
  /**
   * List all transcripts for a variant
   */
  ipcMain.handle('transcripts:list', async (_event, variantId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = VariantIdSchema.safeParse(variantId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid transcripts:list params: ${validated.error.message}`,
          'transcripts'
        )
        throw new Error('Invalid parameters')
      }

      const pool = getDbPool?.()
      if (pool) {
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
        const validatedVariantId = VariantIdSchema.safeParse(variantId)
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

        const db = getDb()
        db.transcripts.switchSelectedTranscript(validatedVariantId.data, validatedTranscriptId.data)
        return { success: true }
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
        const validatedVariantId = VariantIdSchema.safeParse(variantId)
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

        const db = getDb()
        db.transcripts.insertTranscriptAndSwitch(
          validatedVariantId.data,
          validatedTranscript.data as TranscriptInsertRow
        )
        return { success: true }
      })
    }
  )
}
