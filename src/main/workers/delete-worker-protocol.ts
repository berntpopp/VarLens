import type { CaseDeletePhase } from '../../shared/types/case-delete-job'

/** Main → delete worker. */
export type DeleteWorkerRequest =
  | {
      type: 'start'
      mode: 'all' | 'ids'
      dbPath: string
      encryptionKey?: string
      ids?: number[]
    }
  | { type: 'cancel' }

/** Delete worker → main. */
export type DeleteWorkerResponse =
  | { type: 'progress'; phase: CaseDeletePhase; current: number; total: number }
  | { type: 'complete'; deleted: number; cancelled: boolean }
  | { type: 'error'; error: string }
