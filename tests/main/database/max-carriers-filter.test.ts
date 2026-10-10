/**
 * "Seen in at most K cases" (#455) on SQLite. The case view reads
 * variant_frequency.case_count, the cohort view cohort_variant_summary.carrier_count.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CohortSearchParams } from '../../../src/shared/types/cohort'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { runCohortExport } from '../../../src/main/workers/cohort-export'

import { DatabaseService } from '../../../src/main/database'
import { makeVariant as _makeVariant } from '../../utils/make-variant'

type Row = Record<string, unknown>

function makeVariant(overrides: Row = {}) {
  return _makeVariant({ gene_symbol: null, consequence: null, ...overrides })
}

/** Carried by every case that imports it. */
const SHARED: Row = { pos: 100 }
/** Carried by the first case only. */
const UNIQUE: Row = { pos: 200, ref: 'C', alt: 'T' }

describe('carrier cap (#455), SQLite', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => service.close())

  /** Import a case and count it in variant_frequency, as the import does. */
  function importCase(name: string, variants: Row[]): number {
    const id = service.cases.createCase(name, `/${name}.json`, 100)
    service.variants.insertVariantsBatch(
      id,
      variants.map((v) => makeVariant(v))
    )
    service.variants.updateFrequencies(id)
    return id
  }

  /** Three cases: SHARED in all three, UNIQUE in the first. */
  function importThreeCases(): number[] {
    return [
      importCase('c1', [SHARED, UNIQUE]),
      importCase('c2', [SHARED]),
      importCase('c3', [SHARED])
    ]
  }

  function caseView(caseId: number, max?: number): { positions: number[]; total: number } {
    const result = service.variants.getVariants({ case_id: caseId, carrier_count_max: max }, 50, 0)
    return {
      positions: result.data.map((v) => v.pos).sort((a, b) => a - b),
      total: result.total_count
    }
  }

  describe('case view', () => {
    it('K = 1, K = 3 and off; the current case counts exactly once', () => {
      const [c1, c2] = importThreeCases()

      expect(caseView(c1, 1)).toEqual({ positions: [200], total: 1 })
      // SHARED is in exactly 3 cases: 2 drops it, 3 keeps it.
      expect(caseView(c1, 2)).toEqual({ positions: [200], total: 1 })
      expect(caseView(c1, 3)).toEqual({ positions: [100, 200], total: 2 })
      expect(caseView(c1)).toEqual({ positions: [100, 200], total: 2 })
      expect(caseView(c2, 2)).toEqual({ positions: [], total: 0 })
      expect(caseView(c2, 3)).toEqual({ positions: [100], total: 1 })
    })

    it('several transcript rows of one case count once; a second imported case counts', () => {
      const c1 = importCase('c1', [
        { ...SHARED, transcript: 'NM_1' },
        { ...SHARED, transcript: 'NM_2' }
      ])
      expect(caseView(c1, 1)).toEqual({ positions: [100, 100], total: 2 })

      importCase('c2', [SHARED])
      expect(caseView(c1, 1)).toEqual({ positions: [], total: 0 })
      expect(caseView(c1, 2)).toEqual({ positions: [100, 100], total: 2 })
    })

    it('keeps a variant without a frequency row', () => {
      const id = service.cases.createCase('c1', '/c1.json', 100)
      service.variants.insertVariantsBatch(id, [makeVariant(SHARED)])
      // No updateFrequencies: variant_frequency has no row for it.
      expect(caseView(id, 1)).toEqual({ positions: [100], total: 1 })
    })

    // Review Focus 4
    it('a deleted case no longer counts', () => {
      const c1 = importCase('c1', [SHARED])
      const c2 = importCase('c2', [SHARED])
      expect(caseView(c1, 1).positions).toEqual([])

      service.variants.decrementFrequencies(c2)
      expect(caseView(c1, 1).positions).toEqual([100])
    })

    // Review Focus 2: a value below 1 can only come from a stored preset.
    it('a cap below 1 is off', () => {
      const [c1] = importThreeCases()
      expect(caseView(c1, 0)).toEqual({ positions: [100, 200], total: 2 })
    })
  })

  const coordKey = (v: { chr: string; pos: number; ref: string; alt: string }): string =>
    `${v.chr}:${v.pos}:${v.ref}:${v.alt}`

  /** Cohort page over a FRESH summary. */
  function cohortView(params: CohortSearchParams = {}): { keys: string[]; total: number } {
    service.cohortSummary.rebuild()
    service.cohort.invalidateColumnMetaCache()
    const result = service.cohort.getCohortVariants({ limit: 100, ...params })
    return { keys: result.data.map(coordKey).sort(), total: result.total_count }
  }

  describe('cohort view', () => {
    it('K = 1, K = 3 and off', () => {
      importThreeCases()

      expect(cohortView({ carrier_count_max: 1 })).toEqual({ keys: ['1:200:C:T'], total: 1 })
      expect(cohortView({ carrier_count_max: 2 })).toEqual({ keys: ['1:200:C:T'], total: 1 })
      expect(cohortView({ carrier_count_max: 3 })).toEqual({
        keys: ['1:100:A:G', '1:200:C:T'],
        total: 2
      })
      expect(cohortView()).toEqual({ keys: ['1:100:A:G', '1:200:C:T'], total: 2 })
    })

    // Review Focus 3
    it('combines with the minimum; a contradictory range is an empty page', () => {
      importThreeCases()

      expect(cohortView({ carrier_count_min: 2, carrier_count_max: 3 })).toEqual({
        keys: ['1:100:A:G'],
        total: 1
      })
      expect(cohortView({ carrier_count_min: 3, carrier_count_max: 2 })).toEqual({
        keys: [],
        total: 0
      })
    })

    // Review Focus 2
    it('a cap below 1 is off', () => {
      importThreeCases()
      expect(cohortView({ carrier_count_max: 0 }).total).toBe(2)
    })
  })

  // Spec: single genome build (createCase defaults to GRCh38) and a fresh summary.
  // The two views read different tables; no equality is claimed otherwise.
  describe('case view and cohort view, single build, fresh summary', () => {
    it.each([1, 2, 3, undefined])('return the same variants for K = %s', (max) => {
      const caseIds = importThreeCases()

      const fromCases = new Set<string>()
      for (const caseId of caseIds) {
        const page = service.variants.getVariants(
          { case_id: caseId, carrier_count_max: max },
          50,
          0
        )
        for (const v of page.data) fromCases.add(coordKey(v))
      }
      const cohort = cohortView({ carrier_count_max: max })

      expect([...fromCases].sort()).toEqual(cohort.keys)
      expect(cohort.total).toBe(fromCases.size)
    })
  })
  describe('cohort export', () => {
    it('holds the rows of the table and names the cap', () => {
      importThreeCases()
      service.cohortSummary.rebuild()
      const dir = mkdtempSync(join(tmpdir(), 'varlens-max-carriers-'))
      try {
        const file = join(dir, 'cohort.xlsx')
        const result = runCohortExport(service.db, { carrier_count_max: 1 }, file, () => {})
        const book = XLSX.read(readFileSync(file))
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          book.Sheets['Cohort Variants']
        )
        expect(rows.map((row) => row['Position'])).toEqual([200])
        expect(result.rowCount).toBe(1)

        const info = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Export Info'], { header: 1 })
        expect(info).toContainEqual(['Max Carrier Cases', 1])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
