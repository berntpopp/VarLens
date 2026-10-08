import { describe, expect, it, vi } from 'vitest'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import { DatabaseService } from '../../../src/main/database'
import { SET_IMPORT_SESSION_OPEN_SQL } from '../../../src/main/database/cohort-summary-case-add-sql'
import { createFTSTriggers } from '../../../src/main/database/schema'
import { DROP_FTS_TRIGGERS, DROP_INDEXES } from '../../../src/main/workers/import-pipeline'
import {
  finalizeInterruptedImportFts,
  postTerminalMessageAfterCleanup,
  repairInterruptedImportSession,
  type ImportFtsFinalizationState
} from '../../../src/main/workers/import-finalization'

describe('finalizeInterruptedImportFts', () => {
  it('rebuilds FTS when triggers were dropped and normal rebuild did not run', () => {
    const db = {} as DatabaseType
    const state: ImportFtsFinalizationState = {
      ftsTriggersDropped: true,
      ftsRebuilt: false
    }
    const rebuildFts = vi.fn()

    const rebuilt = finalizeInterruptedImportFts(db, state, rebuildFts)

    expect(rebuilt).toBe(true)
    expect(rebuildFts).toHaveBeenCalledExactlyOnceWith(db)
    expect(state.ftsRebuilt).toBe(true)
  })

  it('does not rebuild FTS when normal rebuild already ran', () => {
    const db = {} as DatabaseType
    const state: ImportFtsFinalizationState = {
      ftsTriggersDropped: true,
      ftsRebuilt: true
    }
    const rebuildFts = vi.fn()

    const rebuilt = finalizeInterruptedImportFts(db, state, rebuildFts)

    expect(rebuilt).toBe(false)
    expect(rebuildFts).not.toHaveBeenCalled()
  })
})

describe('postTerminalMessageAfterCleanup', () => {
  it('runs cleanup before posting a terminal message', () => {
    const events: string[] = []

    postTerminalMessageAfterCleanup(
      { type: 'error', fileIndex: -1 },
      () => {
        events.push('cleanup')
      },
      (msg) => {
        events.push(`post:${msg.type}:${msg.fileIndex}`)
      }
    )

    expect(events).toEqual(['cleanup', 'post:error:-1'])
  })

  it('runs cleanup without posting when there is no terminal message', () => {
    const cleanup = vi.fn()
    const postMessage = vi.fn()

    postTerminalMessageAfterCleanup(null, cleanup, postMessage)

    expect(cleanup).toHaveBeenCalledOnce()
    expect(postMessage).not.toHaveBeenCalled()
  })
})

/** #505: the process died in the "finalizing" phase, after the cases were published. */
describe('repairInterruptedImportSession', () => {
  const SESSION_INDEXES = [
    'idx_variants_case_chr_rank',
    'idx_variants_case_coords',
    'idx_variants_filter_covering',
    'idx_variants_gene_notnull'
  ]
  const indexNames = (service: DatabaseService): string[] =>
    (
      service.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'variants'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)

  /** What a session killed at 99 % leaves, as the next app start finds it. */
  function killedWhileFinalizing(markSessionOpen: boolean): {
    service: DatabaseService
    caseId: number
  } {
    const service = new DatabaseService(':memory:')
    const db = service.database
    db.exec(DROP_FTS_TRIGGERS)
    db.exec(DROP_INDEXES)
    if (markSessionOpen) db.exec(SET_IMPORT_SESSION_OPEN_SQL)
    const caseId = service.cases.createCase('killed', '/tmp/killed.vcf', 1)
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol) VALUES (?, '1', 100, 'A', 'T', 'KILLEDGENE')"
    ).run(caseId)
    db.exec(createFTSTriggers) // startup puts the triggers back, not the index
    return { service, caseId }
  }

  it('recreates the session indexes and the FTS index of an open session', () => {
    const { service, caseId } = killedWhileFinalizing(true)
    expect(service.variants.searchVariants(caseId, 'KILLEDGENE')).toHaveLength(0)

    expect(repairInterruptedImportSession(service.database)).toBe(true)

    expect(indexNames(service)).toEqual(expect.arrayContaining(SESSION_INDEXES))
    expect(service.variants.searchVariants(caseId, 'KILLEDGENE')).toHaveLength(1)
    service.close()
  })

  it('leaves a database without an open session alone', () => {
    const { service } = killedWhileFinalizing(false)

    expect(repairInterruptedImportSession(service.database)).toBe(false)

    expect(indexNames(service)).not.toContain('idx_variants_case_coords')
    service.close()
  })
})
