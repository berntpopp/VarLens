/**
 * Migration v46 (#555, mirrors PG 0029): no-call rows stopped counting as
 * carriers. A summary written before counts them, and the incremental delete
 * now subtracts carrier rows only, so its rows would never reach 0. The
 * migration flags a populated summary stale; the next delete (or app start)
 * rebuilds it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { rebuildCohortSummaryCancellable } from '../../../src/main/workers/cancellable-summary-rebuild'
import {
  deleteCasesIncrementally,
  openSummaryRemovalForDelete
} from '../../../src/main/workers/delete-operations'
import { makeVariant } from '../../utils/make-variant'

const SV = { chr: '1', pos: 5000, ref: 'N', alt: '<DEL>', variant_type: 'sv', end_pos: 9000 }

describe('migration v46: summaries counted before the no-call rule are rebuilt', () => {
  let service: DatabaseService
  let noCall: number
  let carrier: number

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    noCall = service.cases.createCase('no-call', '/a.vcf', 1)
    carrier = service.cases.createCase('carrier', '/b.vcf', 1)
    service.variants.insertVariantsBatch(noCall, [makeVariant({ ...SV, gt_num: './.' })])
    service.variants.insertVariantsBatch(carrier, [makeVariant({ ...SV, gt_num: '0/1' })])
    service.cohortSummary.rebuild()
    // The summary as the previous version wrote it: the no-call counted too.
    service.db.exec('UPDATE cohort_variant_summary SET carrier_count = 2')
    service.db.exec('PRAGMA user_version = 45')
  })

  afterEach(() => service.close())

  const svRows = (): unknown[] =>
    service.db.prepare('SELECT carrier_count FROM cohort_variant_summary WHERE pos = 5000').all()

  it('is the latest schema version and flags the populated summary stale', () => {
    runMigrations(service.db)
    expect(service.db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(
      service.db.prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").get()
    ).toEqual({ value: '1' })
  })

  it('a case delete after the migration takes carrier_count to 0 and removes the row', async () => {
    runMigrations(service.db)
    // As the delete worker does: a stale summary is rebuilt, not patched.
    const summary = openSummaryRemovalForDelete(service.db, false)
    expect(summary).toBeNull()
    await deleteCasesIncrementally(service.db, [carrier], {
      deletingAll: false,
      summary,
      isCancelled: () => false,
      onProgress: () => undefined
    })
    await rebuildCohortSummaryCancellable(service.db, () => false)
    expect(svRows()).toEqual([])
  })
})
