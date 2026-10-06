import type { OverrideHandler } from './types'

export function buildDatabaseOverrides(): Record<string, OverrideHandler> {
  return {
    // Web mode reports the storage session's capabilities as-is. Variant and
    // cohort export are served as streamed browser downloads by
    // routes/export-download.ts, so `export.*` stays as the session declares it.
    'database:capabilities': {
      async handle(_args, _request, _reply, { session }) {
        return session.capabilities
      }
    },

    'database:health': {
      async handle(_args, _request, _reply, { session }) {
        return await session.health()
      }
    },

    'database:info': {
      handle(_args, _request, _reply, { session }) {
        return {
          path: `web:${session.capabilities.backend}`,
          name: 'VarLens Web',
          encrypted: false
        }
      }
    },

    'database:getOverview': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'database:overview',
          params: []
        })
      }
    }
  }
}
