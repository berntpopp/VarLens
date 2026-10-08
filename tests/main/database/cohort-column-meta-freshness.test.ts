/**
 * The cohort column-meta cache lives per connection. DB worker threads are
 * never told that an import (another connection) changed the summary, so the
 * cache must notice by itself (#505).
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'
import { openImportSummarySession } from '../../../src/main/database/cohort-summary-case-add'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { applyVariantAnnotationChange } from '../../../src/main/database/cohort-summary-coordinate-recompute'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'

const variant = (pos: number, gene: string): Omit<Variant, 'id' | 'case_id'> =>
  ({ chr: '1', pos, ref: 'A', alt: 'T', gt_num: '0/1', gene_symbol: gene }) as unknown as Omit<
    Variant,
    'id' | 'case_id'
  >

describe('cohort column meta across connections', () => {
  let dir: string
  let reader: DatabaseService
  let writer: DatabaseService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-cohort-meta-'))
    writer = new DatabaseService(join(dir, 'cohort.db'))
    reader = new DatabaseService(join(dir, 'cohort.db'))
  })

  afterEach(() => {
    reader.close()
    writer.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const genes = (): string[] | undefined =>
    reader.cohort.getColumnMeta().find((m) => m.key === 'gene_symbol')?.distinctValues

  it('offers the values another connection imported', () => {
    const first = writer.cases.createCase('a', '/tmp/a.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(first, [variant(100, 'BRCA1')])
    writer.cohortSummary.rebuild()
    expect(genes()).toEqual(['BRCA1'])

    const second = writer.cases.createCase('b', '/tmp/b.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(second, [variant(200, 'TP53')])
    writer.cohortSummary.rebuild()

    expect(genes()).toEqual(['BRCA1', 'TP53'])
  })

  it('keeps serving the cached list while nothing was committed', () => {
    const first = writer.cases.createCase('a', '/tmp/a.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(first, [variant(100, 'BRCA1')])
    writer.cohortSummary.rebuild()

    expect(reader.cohort.getColumnMeta()).toBe(reader.cohort.getColumnMeta())
  })

  it('keeps the cached list when another connection commits something else', () => {
    const first = writer.cases.createCase('a', '/tmp/a.json', 0, 'GRCh38')
    writer.variants.insertVariantsBatch(first, [variant(100, 'BRCA1')])
    writer.cohortSummary.rebuild()
    const cached = reader.cohort.getColumnMeta()

    // A star, a lookup-cache write: any commit that leaves the summary alone.
    writer.database.prepare('UPDATE cases SET name = ? WHERE id = ?').run('renamed', first)

    expect(reader.cohort.getColumnMeta()).toBe(cached)
  })

  /** Every path that writes summary rows; triggers tell whether one did. */
  describe('each summary writer invalidates the cache', () => {
    const db = (): DatabaseService['database'] => writer.database
    const addCase = (pos: number, gene: string): number => {
      const id = Number(
        db()
          .prepare(
            `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
             VALUES (?, '/tmp/x.json', 1, 0, 0, 'GRCh38')`
          )
          .run(`case-${pos}`).lastInsertRowid
      )
      db()
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, variant_type)
           VALUES (?, '1', ?, 'A', 'T', ?, '0/1', 'snv')`
        )
        .run(id, pos, gene)
      return id
    }
    const session = (): ReturnType<typeof openImportSummarySession> =>
      openImportSummarySession(db(), {
        forceRebuild: false,
        rebuild: () => rebuildCohortSummary(db()),
        onWarning: (warning) => {
          throw new Error(warning)
        }
      })

    const writers: Record<string, (existing: number) => void> = {
      'full rebuild': () => {
        addCase(200, 'TP53')
        writer.cohortSummary.rebuild()
      },
      'import session add': () => session().addCase(addCase(200, 'TP53')),
      'case removal': (existing) => {
        const removal = openCaseSummaryRemoval(db())
        removal?.beforeDelete(existing)
        db().prepare('DELETE FROM variants WHERE case_id = ?').run(existing)
        removal?.afterDelete()
      },
      'transcript switch': () => {
        db().prepare("UPDATE variants SET gene_symbol = 'TP53' WHERE pos = 100").run()
        applyVariantAnnotationChange(
          db(),
          { chr: '1', pos: 100, ref: 'A', alt: 'T' },
          'BRCA1',
          'TP53'
        )
      },
      'legacy incremental add': () => writer.cohortSummary.incrementalAdd(addCase(200, 'TP53')),
      'legacy incremental remove': (existing) => writer.cohortSummary.incrementalRemove(existing)
    }

    it.each(Object.keys(writers))('%s', (name) => {
      const existing = addCase(100, 'BRCA1')
      writer.cohortSummary.rebuild()
      db().exec(`
        CREATE TABLE zz_summary_writes (n INTEGER);
        CREATE TRIGGER zz_ins AFTER INSERT ON cohort_variant_summary
          BEGIN INSERT INTO zz_summary_writes VALUES (1); END;
        CREATE TRIGGER zz_del AFTER DELETE ON cohort_variant_summary
          BEGIN INSERT INTO zz_summary_writes VALUES (1); END;
        CREATE TRIGGER zz_upd AFTER UPDATE OF gene_symbol, carrier_count, het_count, hom_count
          ON cohort_variant_summary BEGIN INSERT INTO zz_summary_writes VALUES (1); END;
      `)
      const cached = reader.cohort.getColumnMeta()

      writers[name](existing)

      expect(db().prepare('SELECT COUNT(*) FROM zz_summary_writes').pluck().get()).toBeGreaterThan(
        0
      )
      expect(reader.cohort.getColumnMeta()).not.toBe(cached)
    })
  })
})
