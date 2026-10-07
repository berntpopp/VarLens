/**
 * A migrated scratch database plus the import worker's session entry point,
 * for tests that watch the cohort summary while a session runs.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'

import { initializeSchema } from '../../../../src/main/database/schema'
import { runMigrations } from '../../../../src/main/database/migrations'
import { runImportSession } from '../../../../src/main/workers/import-worker'
import type { MainMessage, WorkerMessage } from '../../../../src/shared/types/import-worker'

type StartMessage = Extract<MainMessage, { type: 'start' }>
export type SessionFile = StartMessage['files'][number]
export type SessionVariant = Record<string, string | number | null>

export const variantAt = (
  pos: number,
  gene: string | null,
  extra: SessionVariant = {}
): SessionVariant => ({
  chr: 'chr1',
  pos,
  ref: 'A',
  alt: 'G',
  gene_symbol: gene,
  gt_num: '0/1',
  consequence: 'MODERATE',
  func: 'missense_variant',
  ...extra
})

export interface SessionRun {
  /** Called with every worker message, in order, as the worker posts it. */
  onMessage?: (message: WorkerMessage) => void
  isCancelled?: () => boolean
  discardCaseIds?: number[]
  /** Rows per insert transaction; 1 makes every row its own commit. */
  batchSize?: number
}

export interface SummarySessionHarness {
  readonly dbPath: string
  /** A second connection, as the main process or another worker would hold. */
  readonly db: DatabaseType
  file(caseName: string, variants: SessionVariant[], extra?: Partial<SessionFile>): SessionFile
  run(files: SessionFile[], options?: SessionRun): Promise<WorkerMessage[]>
  close(): void
}

export function openSummarySessionHarness(): SummarySessionHarness {
  const dir = mkdtempSync(join(tmpdir(), 'varlens-summary-session-'))
  const dbPath = join(dir, 'test.db')
  const db = new Database(dbPath)
  initializeSchema(db)
  runMigrations(db)
  let fileCount = 0

  return {
    dbPath,
    db,
    file(caseName, variants, extra = {}) {
      const filePath = join(dir, `file-${fileCount++}.json`)
      writeFileSync(filePath, JSON.stringify({ variants }))
      return { filePath, caseName, ...extra } as SessionFile
    },
    async run(files, options = {}) {
      const messages: WorkerMessage[] = []
      await runImportSession(
        {
          type: 'start',
          files,
          dbPath,
          throttleMs: 0,
          batchSize: options.batchSize,
          discardCaseIds: options.discardCaseIds
        },
        {
          postMessage: (message) => {
            messages.push(message)
            options.onMessage?.(message)
          }
        },
        options.isCancelled ?? (() => false)
      )
      return messages
    },
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** `caseName:status` of every file of a finished session. */
export function sessionStatuses(messages: WorkerMessage[]): string[] {
  const done = messages.find((m) => m.type === 'complete')
  if (done?.type !== 'complete') throw new Error('session did not complete')
  return done.results.details.map((d) => `${d.caseName}:${d.status}`)
}
