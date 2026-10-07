// @vitest-environment node
/**
 * The incremental case removal (delete worker, import overwrite) must leave
 * has_star / has_comment / acmg_best equal to a full rebuild, including the
 * part that comes from per-case annotations (case_variant_annotations):
 *  - a coordinate recomputed because the deleted case held a stored maximum
 *    must keep the flags the REMAINING cases' per-case annotations give it;
 *  - a coordinate that is only decremented must lose the flags that came
 *    from the DELETED case's per-case annotations.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { referenceSummary, snapshotSummary } from '../workers/support/summary-reference'

describe('incremental case removal keeps per-case annotation flags exact', () => {
  let service: DatabaseService
  const db = (): DatabaseService['database'] => service.database

  const addCase = (name: string): number =>
    Number(
      db()
        .prepare(
          `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
           VALUES (?, '/tmp/x.json', 1, 0, 0, 'GRCh38')`
        )
        .run(name).lastInsertRowid
    )
  const addVariant = (caseId: number, pos: number, cadd: number): number =>
    Number(
      db()
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, cadd, gt_num, variant_type)
           VALUES (?, 'chr1', ?, 'A', 'G', 'GENE', ?, '0/1', 'snv')`
        )
        .run(caseId, pos, cadd).lastInsertRowid
    )
  const flags = (pos: number): unknown =>
    db()
      .prepare(
        'SELECT carrier_count, cadd, has_star, has_comment, acmg_best FROM cohort_variant_summary WHERE pos = ?'
      )
      .get(pos)

  async function deleteCase(caseId: number): Promise<void> {
    const summary = openCaseSummaryRemoval(db())
    expect(summary).not.toBeNull()
    await deleteCasesIncrementally(db(), [caseId], {
      deletingAll: false,
      isCancelled: () => false,
      onProgress: () => undefined,
      summary
    })
  }

  let keep: number
  let gone: number

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    keep = addCase('keep')
    gone = addCase('gone')
  })

  afterEach(() => service.close())

  it('a recomputed coordinate keeps the remaining case’s per-case flags', async () => {
    const keptVariant = addVariant(keep, 100, 10)
    addVariant(gone, 100, 30) // holds the CADD maximum: its removal recomputes the row
    service.cohortSummary.rebuild()
    service.annotations.upsertPerCaseAnnotation(keep, keptVariant, {
      starred: true,
      per_case_comment: 'mine',
      acmg_classification: 'Likely pathogenic'
    })
    expect(snapshotSummary(db())).toEqual(referenceSummary(db()))

    await deleteCase(gone)

    expect(flags(100)).toEqual({
      carrier_count: 1,
      cadd: 10,
      has_star: 1,
      has_comment: 1,
      acmg_best: 'Likely pathogenic'
    })
    expect(snapshotSummary(db())).toEqual(referenceSummary(db()))
  })

  it('a decremented coordinate loses the deleted case’s per-case flags', async () => {
    addVariant(keep, 200, 30)
    const goneVariant = addVariant(gone, 200, 10) // below the maximum: decrement only
    service.cohortSummary.rebuild()
    service.annotations.upsertPerCaseAnnotation(gone, goneVariant, {
      starred: true,
      per_case_comment: 'theirs',
      acmg_classification: 'Pathogenic'
    })
    expect(flags(200)).toMatchObject({ has_star: 1, acmg_best: 'Pathogenic' })

    await deleteCase(gone)

    expect(flags(200)).toEqual({
      carrier_count: 1,
      cadd: 30,
      has_star: 0,
      has_comment: 0,
      acmg_best: null
    })
    expect(snapshotSummary(db())).toEqual(referenceSummary(db()))
  })
})
