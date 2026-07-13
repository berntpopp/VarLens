import { z } from 'zod'
import { TRANSCRIPT_IMPACT_VALUES } from '../../types/transcript'

export const TranscriptVariantIdSchema = z.number().int().positive()
export const TranscriptIdSchema = z.string().min(1)

export const TranscriptInsertRowSchema = z.object({
  transcript_id: z.string().min(1),
  gene_symbol: z.string().nullable(),
  consequence: z.enum(TRANSCRIPT_IMPACT_VALUES).nullable(),
  func: z.string().nullable(),
  cdna: z.string().nullable(),
  aa_change: z.string().nullable(),
  hpo_sim_score: z.number().nullable(),
  moi: z.string().nullable(),
  is_selected: z.number().int().min(0).max(1)
})

export const TranscriptInvokeBodySchemas = {
  list: z.object({
    args: z.tuple([TranscriptVariantIdSchema])
  }),
  switch: z.object({
    args: z.tuple([TranscriptVariantIdSchema, TranscriptIdSchema])
  }),
  insertAndSwitch: z.object({
    args: z.tuple([TranscriptVariantIdSchema, TranscriptInsertRowSchema])
  })
} as const

export const TranscriptSwitchResponseSchema = z.object({
  success: z.boolean()
})

export const TranscriptUnknownResponseSchema = z.unknown()

export type TranscriptInsertRowInput = z.infer<typeof TranscriptInsertRowSchema>
