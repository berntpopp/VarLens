/**
 * Transcripts business logic and shared handler factory (spec §4.1, Limin L1).
 *
 * One implementation used by both Electron IPC (transcripts.ts) and Fastify
 * web dispatch (routes/transcripts.ts). Input validation is shared here so
 * both transports enforce identical boundaries.
 *
 * This module is transport-neutral and must not import Electron.
 */

import {
  TranscriptIdSchema,
  TranscriptInsertRowSchema,
  TranscriptVariantIdSchema
} from '../../../shared/api/schemas/transcripts'
import type { TranscriptsDomainContract } from '../../../shared/ipc/domains/transcripts'
import type { TranscriptAnnotation, TranscriptInsertRow } from '../../../shared/types/transcript'
import { InvalidParametersError } from '../errors'
import type { StorageSession } from '../../storage/session'
import type { DomainHandlerDependencies, DomainHandlers } from '../../handlers-core/types'

export type TranscriptsHandlers = DomainHandlers<TranscriptsDomainContract>

/** What a transport is told beyond the IPC result. */
export interface TranscriptsEvents {
  /**
   * A switch landed while an import session was open (SQLite): the cohort
   * summary could not be patched and is flagged stale until that session
   * rebuilds it. Nothing else reports this edit to the renderer.
   */
  onCohortSummaryStale?: () => void
}

/** Storage result of a switch: the IPC result plus the storage-side notice. */
interface SwitchWriteResult {
  success: boolean
  cohortSummaryStale?: boolean
}

function reportSwitch(result: unknown, events: TranscriptsEvents): { success: boolean } {
  const { success, cohortSummaryStale } = result as SwitchWriteResult
  if (cohortSummaryStale === true) events.onCohortSummaryStale?.()
  return { success }
}

export async function listTranscripts(
  variantId: unknown,
  getSession: () => StorageSession
): Promise<TranscriptAnnotation[]> {
  const validated = TranscriptVariantIdSchema.safeParse(variantId)
  if (!validated.success) {
    throw new InvalidParametersError('Invalid parameters')
  }

  const session = getSession()
  return (await session.getReadExecutor().execute({
    type: 'transcripts:list',
    params: [validated.data]
  })) as TranscriptAnnotation[]
}

export async function switchTranscript(
  variantId: unknown,
  transcriptId: unknown,
  getSession: () => StorageSession,
  events: TranscriptsEvents = {}
): Promise<{ success: boolean }> {
  const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
  const validatedTranscriptId = TranscriptIdSchema.safeParse(transcriptId)
  if (!validatedVariantId.success || !validatedTranscriptId.success) {
    throw new InvalidParametersError('Invalid parameters')
  }
  const session = getSession()
  const result = await session.getWriteExecutor().execute({
    type: 'transcripts:switch',
    params: [validatedVariantId.data, validatedTranscriptId.data]
  })
  return reportSwitch(result, events)
}

export async function insertAndSwitchTranscript(
  variantId: unknown,
  transcript: unknown,
  getSession: () => StorageSession,
  events: TranscriptsEvents = {}
): Promise<{ success: boolean }> {
  const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
  const validatedTranscript = TranscriptInsertRowSchema.safeParse(transcript)
  if (!validatedVariantId.success || !validatedTranscript.success) {
    throw new InvalidParametersError('Invalid parameters')
  }

  const session = getSession()
  const result = await session.getWriteExecutor().execute({
    type: 'transcripts:insertAndSwitch',
    params: [validatedVariantId.data, validatedTranscript.data as TranscriptInsertRow]
  })
  return reportSwitch(result, events)
}

export function createTranscriptsHandlers(
  deps: DomainHandlerDependencies,
  events: TranscriptsEvents = {}
): TranscriptsHandlers {
  return {
    list: (variantId: number) => listTranscripts(variantId, deps.getSession),
    switch: (variantId: number, transcriptId: string) =>
      switchTranscript(variantId, transcriptId, deps.getSession, events),
    insertAndSwitch: (variantId: number, transcript: TranscriptInsertRow) =>
      insertAndSwitchTranscript(variantId, transcript, deps.getSession, events)
  }
}
