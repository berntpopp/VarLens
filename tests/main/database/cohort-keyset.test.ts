/**
 * Cohort keyset paging on SQLite (default `carrier_count DESC` sort).
 *
 * Pages chained through `next_cursor` must equal the OFFSET pages and the
 * pre-keyset order (carrier_count DESC NULLS LAST, natural chromosome, pos,
 * ref, alt), including heavy carrier-count ties; the v36 index must serve the
 * order without a sort; stale or foreign cursors must fall back to OFFSET.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database'
import { COHORT_KEYSET_INDEX } from '../../../src/shared/sql/cohort-keyset'
import { cohortOrderByClause } from '../../../src/shared/sql/chromosome-order'
import type { CohortSearchParams, CohortVariant } from '../../../src/shared/types/cohort'

const CONTIGS = ['10', 'X', '2', 'MT', '1', 'GL000220.1', '22']

describe('SQLite cohort keyset paging', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    const db = service.database
    const insertCase = db.prepare(
      `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES (?, '/tmp/x.json', 1, 0, 0, 'GRCh38')`
    )
    const insertVariant = db.prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num)
       VALUES (?, ?, ?, 'A', ?, 'GENE', '0/1')`
    )
    for (let c = 1; c <= 5; c++) {
      const id = Number(insertCase.run(`case-${c}`).lastInsertRowid)
      for (let i = 0; i < 60; i++) {
        // Case c carries every coordinate i with i % c === 0 → many ties.
        if (i % c !== 0) continue
        insertVariant.run(id, CONTIGS[i % CONTIGS.length], 1000 + (i % 9) * 10, i % 2 ? 'G' : 'T')
      }
    }
    service.cohortSummary.rebuild()
  })

  afterEach(() => {
    service.close()
  })

  const key = (v: CohortVariant): string => `${v.chr}:${v.pos}:${v.ref}>${v.alt}#${v.carrier_count}`

  function referenceOrder(params: CohortSearchParams = {}): string[] {
    const where = params.carrier_count_min !== undefined ? 'WHERE carrier_count >= ?' : ''
    const rows = service.database
      .prepare(
        `SELECT chr, pos, ref, alt, carrier_count FROM cohort_variant_summary ${where}
         ${cohortOrderByClause('carrier_count', 'carrier_count', 'desc')}`
      )
      .all(...(params.carrier_count_min !== undefined ? [params.carrier_count_min] : []))
    return (rows as CohortVariant[]).map(key)
  }

  function pageAll(limit: number, params: CohortSearchParams = {}): string[] {
    const out: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const result = service.cohort.getCohortVariants({
        ...params,
        limit,
        offset: page * limit,
        cursor
      })
      if (page > 0 && cursor !== undefined) expect(result.paging).toBe('keyset')
      out.push(...result.data.map(key))
      for (const row of result.data) {
        expect(row).not.toHaveProperty('_keyset_variant_type')
      }
      if (result.data.length < limit) {
        expect(result.next_cursor).toBeUndefined()
        break
      }
      cursor = result.next_cursor
      expect(cursor).toBeTypeOf('string')
    }
    return out
  }

  it('cursor-chained pages equal the pre-keyset order', () => {
    const expected = referenceOrder()
    expect(expected.length).toBeGreaterThan(40)
    for (const limit of [1, 7, 10, 50]) {
      expect(pageAll(limit)).toEqual(expected)
    }
  })

  it('OFFSET pages (no cursor) return the same order', () => {
    const expected = referenceOrder()
    const offsetPages: string[] = []
    for (let offset = 0; offset < expected.length; offset += 9) {
      offsetPages.push(...service.cohort.getCohortVariants({ limit: 9, offset }).data.map(key))
    }
    expect(offsetPages).toEqual(expected)
  })

  it('works together with filters', () => {
    expect(pageAll(4, { carrier_count_min: 2 })).toEqual(referenceOrder({ carrier_count_min: 2 }))
  })

  it('ignores a cursor minted for another filter set (OFFSET fallback)', () => {
    const first = service.cohort.getCohortVariants({ limit: 5, offset: 0 })
    const other = service.cohort.getCohortVariants({
      limit: 5,
      offset: 5,
      carrier_count_min: 2,
      cursor: first.next_cursor
    })
    expect(other.paging).toBeUndefined()
    expect(other.data.map(key)).toEqual(referenceOrder({ carrier_count_min: 2 }).slice(5, 10))
  })

  it('ignores malformed cursors and non-default sorts', () => {
    const garbage = service.cohort.getCohortVariants({ limit: 5, offset: 5, cursor: 'nope' })
    expect(garbage.paging).toBeUndefined()
    expect(garbage.data.map(key)).toEqual(referenceOrder().slice(5, 10))

    const byGene = service.cohort.getCohortVariants({ limit: 5, sort_by: 'pos' })
    expect(byGene.next_cursor).toBeUndefined()
  })

  it('serves the keyset order and seek from idx_cvs_carrier_keyset without a sort', () => {
    const first = service.cohort.getCohortVariants({ limit: 5 })
    const seen: string[] = []
    const db = service.database
    const original = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes('FROM cohort_variant_summary cvs') && sql.includes('LIMIT')) seen.push(sql)
      return original(sql)
    }) as typeof db.prepare
    try {
      service.cohort.getCohortVariants({ limit: 5, offset: 5, cursor: first.next_cursor })
    } finally {
      db.prepare = original
    }
    expect(seen.length).toBeGreaterThan(0)
    const plan = (
      db
        .prepare(`EXPLAIN QUERY PLAN ${seen[0]}`)
        .all(5, 0, {
          keyset_0: 1,
          keyset_1: '1',
          keyset_2: 1,
          keyset_3: 'A',
          keyset_4: 'G',
          keyset_5: 'snv',
          keyset_6: 'GRCh38'
        }) as Array<{
        detail: string
      }>
    )
      .map((r) => r.detail)
      .join('\n')
    expect(plan).toContain(COHORT_KEYSET_INDEX)
    expect(plan).not.toContain('TEMP B-TREE')
  })
})
