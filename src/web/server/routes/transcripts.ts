import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import { createTranscriptsHandlers } from '../../../main/ipc/handlers/transcripts-logic'
import { InvalidParametersError } from '../../../main/ipc/errors'
import type { OverrideHandler } from './types'

export function buildTranscriptOverrides(): Record<string, OverrideHandler> {
  return {
    'transcripts:list': {
      async handle(args, _request, reply, { session }) {
        const [variantId] = args
        const handlers = createTranscriptsHandlers({ getSession: () => session })
        try {
          return await handlers.list(variantId as number)
        } catch (err) {
          if (err instanceof InvalidParametersError) {
            reply.code(400)
            return { error: 'invalid-transcript-variant-id' }
          }
          throw err
        }
      }
    },

    'transcripts:switch': {
      async handle(args, _request, reply, { session }) {
        const [variantId, transcriptId] = args
        const handlers = createTranscriptsHandlers({ getSession: () => session })
        try {
          return await handlers.switch(variantId as number, transcriptId as string)
        } catch (err) {
          if (err instanceof InvalidParametersError) {
            reply.code(400)
            return { error: 'invalid-transcript-switch' }
          }
          throw err
        }
      }
    },

    'transcripts:insertAndSwitch': {
      async handle(args, _request, reply, { session }) {
        const [variantId, transcript] = args
        const handlers = createTranscriptsHandlers({ getSession: () => session })
        try {
          return await handlers.insertAndSwitch(
            variantId as number,
            transcript as TranscriptInsertRow
          )
        } catch (err) {
          if (err instanceof InvalidParametersError) {
            reply.code(400)
            return { error: 'invalid-transcript-insert' }
          }
          throw err
        }
      }
    }
  }
}
