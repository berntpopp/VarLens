// @vitest-environment node
/**
 * SV type and unsigned length as cohort summary facts (#573, SQLite v54):
 * every maintenance path (rebuild, per-file add, removal) arrives at the same
 * row, and an upgraded database flags its summary for the rebuild that fills
 * the new columns.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { openImportSummarySession } from '../../../src/main/database/cohort-summary-case-add'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { runMigrations } from '../../../src/main/database/migrations'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { referenceSummary, snapshotSummary } from '../workers/support/summary-reference'
import { makeVariant } from '../../utils/make-variant'

const DEL = { chr: '1', pos: 5000, ref: 'N', alt: '<DEL>', variant_type: 'sv', sv_type: 'DEL' }

describe('cohort summary SV facts', () => {
  let service: DatabaseService
  const db = (): DatabaseService['database'] => service.database

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })
  afterEach(() => service.close())

  const addCase = (name: string, endPos: number | null, svLength: number): number => {
    const caseId = service.cases.createCase(name, `/${name}.vcf`, 1, 'GRCh38')
    service.variants.insertVariantsBatch(caseId, [
      makeVariant({ ...DEL, end_pos: endPos, sv_length: svLength }) as never
    ])
    return caseId
  }

  const row = (): unknown =>
    db()
      .prepare('SELECT end_pos, sv_type, sv_length FROM cohort_variant_summary WHERE pos = 5000')
      .get()

  const expectExact = (): void => expect(snapshotSummary(db())).toEqual(referenceSummary(db()))

  it('keeps the longest call unsigned on add and gives it back on removal', async () => {
    service.cohortSummary.rebuild()
    const session = openImportSummarySession(db(), {
      forceRebuild: false,
      rebuild: () => service.cohortSummary.rebuild(),
      onWarning: (warning) => {
        throw new Error(warning)
      }
    })
    const short = addCase('short', 6000, -1000)
    session.addCase(short)
    const long = addCase('long', 9000, -4000)
    session.addCase(long)
    session.addCase(addCase('no-end', null, -200))
    session.finish()
    expect(row()).toEqual({ end_pos: 9000, sv_type: 'DEL', sv_length: 4000 })
    expectExact()

    await deleteCasesIncrementally(db(), [long], {
      deletingAll: false,
      isCancelled: () => false,
      onProgress: () => undefined,
      summary: openCaseSummaryRemoval(db())
    })
    expect(row()).toEqual({ end_pos: 6000, sv_type: 'DEL', sv_length: 1000 })
    expectExact()
  })

  it('v54 adds the columns to an older summary and flags it for the rebuild', () => {
    addCase('a', 9000, -4000)
    service.cohortSummary.rebuild()
    db().exec(`ALTER TABLE cohort_variant_summary DROP COLUMN sv_type;
      ALTER TABLE cohort_variant_summary DROP COLUMN sv_length;
      DELETE FROM cohort_summary_meta WHERE key = 'is_stale';
      PRAGMA user_version = 51;`)

    runMigrations(db())
    expect(
      db().prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").get()
    ).toEqual({ value: '1' })
    service.cohortSummary.rebuild()
    expect(row()).toEqual({ end_pos: 9000, sv_type: 'DEL', sv_length: 4000 })
  })
})
