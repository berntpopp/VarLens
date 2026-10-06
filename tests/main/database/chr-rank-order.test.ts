/**
 * Natural chromosome order on SQLite (desktop): case view + cohort view.
 *
 * Both views must order 1..22, X, Y, MT, then other contigs by name — never
 * lexicographically (1, 10, 11, …, 2). The default case order must also be
 * served by the v33 expression index instead of a full sort.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'
import {
  CHR_RANK_CVS_CARRIER_INDEX,
  CHR_RANK_CVS_INDEX,
  CHR_RANK_VARIANTS_INDEX
} from '../../../src/main/database/chr-rank-indexes'
import { runMigrations } from '../../../src/main/database/migrations'
import { COHORT_KEYSET_INDEX } from '../../../src/shared/sql/cohort-keyset'
import { initializeSchema } from '../../../src/main/database/schema'
import { DROP_INDEXES, RECREATE_INDEXES } from '../../../src/main/workers/import-pipeline'
import { chrRankSql } from '../../../src/shared/sql/chromosome-order'

// Deliberately shuffled; lexicographic order would put 10/11 before 2.
const CONTIGS = ['10', 'MT', 'GL000220.1', '2', 'Y', '1', 'chrUn_KI270742v1', 'X', '22', '11']
const NATURAL = ['1', '2', '10', '11', '22', 'X', 'Y', 'MT', 'GL000220.1', 'chrUn_KI270742v1']

function fixtureVariants(gt: string): Array<Omit<Variant, 'id' | 'case_id'>> {
  // Two positions per contig, inserted high-pos first so `id` order is wrong too.
  return CONTIGS.flatMap((chr) =>
    [2000, 1000].map(
      (pos) =>
        ({
          chr,
          pos,
          ref: 'A',
          alt: 'T',
          gene_symbol: `G${chr}`,
          gt_num: gt
        }) as unknown as Omit<Variant, 'id' | 'case_id'>
    )
  )
}

const coords = (rows: Array<{ chr: string; pos: number }>): string[] =>
  rows.map((r) => `${r.chr}:${r.pos}`)

const naturalCoords = (chromosomes: string[]): string[] =>
  chromosomes.flatMap((chr) => [`${chr}:1000`, `${chr}:2000`])

describe('natural chromosome order — SQLite', () => {
  let sqlite: DatabaseService
  let caseId: number

  beforeEach(() => {
    sqlite = new DatabaseService(':memory:')
    caseId = sqlite.cases.createCase('chr-order-a', '/tmp/a.json', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(caseId, fixtureVariants('0/1'))
    const caseB = sqlite.cases.createCase('chr-order-b', '/tmp/b.json', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(caseB, fixtureVariants('1/1').slice(0, 6))
    sqlite.cohortSummary.rebuild()
    sqlite.cohort.invalidateColumnMetaCache()
  })

  afterEach(() => sqlite.close())

  describe('case view', () => {
    it('defaults to natural chromosome order, then position', () => {
      const page = sqlite.variants.getVariants({ case_id: caseId }, 100, 0)
      expect(coords(page.data)).toEqual(naturalCoords(NATURAL))
    })

    it('sorts by chr ascending and descending in natural order', () => {
      const asc = sqlite.variants.getVariants({ case_id: caseId }, 100, 0, [
        { key: 'chr', order: 'asc' }
      ])
      expect(coords(asc.data)).toEqual(naturalCoords(NATURAL))

      const desc = sqlite.variants.getVariants({ case_id: caseId }, 100, 0, [
        { key: 'chr', order: 'desc' }
      ])
      expect([...new Set(desc.data.map((v) => v.chr))]).toEqual([...NATURAL].reverse())
      // pos stays ascending inside each chromosome
      expect(desc.data.slice(0, 2).map((v) => v.pos)).toEqual([1000, 2000])
    })

    it('pages in the same natural order', () => {
      const first = sqlite.variants.getVariants({ case_id: caseId }, 6, 0)
      const second = sqlite.variants.getVariants({ case_id: caseId }, 6, 6)
      expect([...coords(first.data), ...coords(second.data)]).toEqual(
        naturalCoords(NATURAL).slice(0, 12)
      )
    })

    it('exports in natural order', () => {
      const rows = sqlite.variants.getAllVariantsForExport({ case_id: caseId })
      expect(coords(rows)).toEqual(naturalCoords(NATURAL))
    })

    it('serves the default order from idx_variants_case_chr_rank without a sort', () => {
      const { sql, parameters } = sqlite.variants.compileExportQuery({ case_id: caseId }, 50)
      const plan = sqlite.database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(parameters as unknown[])) as Array<{ detail: string }>
      const details = plan.map((p) => p.detail).join(' | ')
      expect(details).toContain(CHR_RANK_VARIANTS_INDEX)
      expect(details).not.toContain('TEMP B-TREE')
    })
  })

  describe('cohort view', () => {
    it('breaks carrier_count ties in natural chromosome order', () => {
      const rows = sqlite.cohort.getCohortVariants({ limit: 100, offset: 0 }).data
      // The first 6 fixture rows (10, MT, GL… at both positions) have two carriers.
      const shared = rows.filter((r) => r.carrier_count === 2)
      const single = rows.filter((r) => r.carrier_count === 1)
      expect(coords(shared)).toEqual(naturalCoords(['10', 'MT', 'GL000220.1']))
      expect(coords(single)).toEqual(
        naturalCoords(NATURAL.filter((c) => !['10', 'MT', 'GL000220.1'].includes(c)))
      )
      expect(rows.slice(0, shared.length)).toEqual(shared)
    })

    it('sorts by chr ascending and descending in natural order', () => {
      const asc = sqlite.cohort.getCohortVariants({ sort_by: 'chr', sort_order: 'asc' }).data
      expect(coords(asc)).toEqual(naturalCoords(NATURAL))

      const desc = sqlite.cohort.getCohortVariants({ sort_by: 'chr', sort_order: 'desc' }).data
      expect([...new Set(desc.map((v) => v.chr))]).toEqual([...NATURAL].reverse())
    })
  })
})

describe('migration v33 — chr-rank indexes', () => {
  it('creates the case and cohort expression indexes', () => {
    const db = new Database(':memory:')
    try {
      initializeSchema(db)
      runMigrations(db)
      expect(db.pragma('user_version', { simple: true })).toBe(36)
      const names = (
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{
          name: string
        }>
      ).map((r) => r.name)
      expect(names).toEqual(
        expect.arrayContaining([CHR_RANK_VARIANTS_INDEX, CHR_RANK_CVS_INDEX, COHORT_KEYSET_INDEX])
      )
      // v36 replaces the mixed-direction carrier index with the keyset index.
      expect(names).not.toContain(CHR_RANK_CVS_CARRIER_INDEX)
      const variantIndexSql = (
        db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(CHR_RANK_VARIANTS_INDEX) as {
          sql: string
        }
      ).sql
      expect(variantIndexSql).toContain(chrRankSql('chr'))
    } finally {
      db.close()
    }
  })

  it('upgrades a v32 database and is idempotent', () => {
    const db = new Database(':memory:')
    try {
      initializeSchema(db)
      runMigrations(db)
      for (const name of [CHR_RANK_VARIANTS_INDEX, CHR_RANK_CVS_INDEX, COHORT_KEYSET_INDEX]) {
        db.exec(`DROP INDEX ${name}`)
      }
      db.pragma('user_version = 32')
      runMigrations(db)
      runMigrations(db)
      expect(db.pragma('user_version', { simple: true })).toBe(36)
      const count = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name LIKE '%chr_rank%'`
        )
        .get() as { n: number }
      // v33 re-creates three, v36 drops the superseded carrier index again.
      expect(count.n).toBe(2)
    } finally {
      db.close()
    }
  })

  it('is dropped and re-created around bulk imports', () => {
    expect(DROP_INDEXES).toContain(`DROP INDEX IF EXISTS ${CHR_RANK_VARIANTS_INDEX}`)
    expect(RECREATE_INDEXES).toContain(CHR_RANK_VARIANTS_INDEX)
    expect(RECREATE_INDEXES).toContain(chrRankSql('chr'))
  })
})
