/**
 * Who sees a 'provisional' case (`cases.import_status`, migration v40).
 *
 * A case is provisional while its file is being imported: its rows are
 * committed batch by batch but it is no part of the database yet. Everything
 * a user reads must leave it out — lists, counts, cohort, the internal allele
 * frequency (numerator and denominator alike) — while the import's own
 * bookkeeping (duplicate-name check, lookup and delete by id) must find it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { DatabaseOverviewService } from '../../../src/main/database/DatabaseOverviewService'
import { VariantFrequencyService } from '../../../src/main/database/VariantFrequencyService'
import { countCasesForInternalAf } from '../../../src/main/database/variant-filter/core-filters'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'

describe('provisional cases and their readers', () => {
  let service: DatabaseService
  let readyId: number
  let provisionalId: number

  const db = (): DatabaseService['database'] => service.database

  function addVariant(caseId: number, pos: number, type = 'snv'): number {
    return Number(
      db()
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, variant_type)
           VALUES (?, '1', ?, 'A', 'G', 'GENE1', '0/1', ?)`
        )
        .run(caseId, pos, type).lastInsertRowid
    )
  }

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    readyId = service.cases.createCase('ready', '/ready.vcf', 1)
    addVariant(readyId, 100)
    db()
      .prepare('INSERT INTO variant_sv (variant_id, support) VALUES (?, 3)')
      .run(addVariant(readyId, 500, 'sv'))
    new VariantFrequencyService(db()).updateFrequencies(readyId)
    service.cohortSummary.rebuild()

    // An import in flight: rows committed, nothing counted, not published.
    provisionalId = Number(
      db()
        .prepare(
          `INSERT INTO cases
             (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
           VALUES ('in-flight', '/in-flight.vcf', 1, 3, 0, 'GRCh38', 'provisional')`
        )
        .run().lastInsertRowid
    )
    addVariant(provisionalId, 100)
    addVariant(provisionalId, 200)
    db()
      .prepare('INSERT INTO variant_sv (variant_id, support) VALUES (?, 99)')
      .run(addVariant(provisionalId, 500, 'sv'))
  })

  afterEach(() => {
    service.close()
  })

  const frequencies = (): unknown[] =>
    db().prepare('SELECT pos, case_count FROM variant_frequency ORDER BY pos').all()

  describe('readers that must not see it', () => {
    it('case list (cases:list)', () => {
      expect(service.cases.getAllCases().map((c) => c.name)).toEqual(['ready'])
    })

    it('paged case query and its count', () => {
      const page = service.cases.queryCases({ limit: 50 })
      expect(page.data.map((c) => c.name)).toEqual(['ready'])
      expect(page.total_count).toBe(1)
    })

    it('genome-build case counts', () => {
      expect(service.cases.getAvailableGenomeBuilds()).toEqual([{ build: 'GRCh38', caseCount: 1 }])
    })

    it('database overview: case list and totals', () => {
      const overview = new DatabaseOverviewService(db(), service.kysely).getDatabaseOverview()
      expect(overview.cases.map((c) => c.name)).toEqual(['ready'])
      expect(overview.summary.total_cases).toBe(1)
      expect(overview.summary.total_variants).toBe(2)
    })

    it('cohort variants, carriers and case total', () => {
      const cohort = service.cohort.getCohortVariants({ page: 1, items_per_page: 50 } as never)
      expect(cohort.data.map((row) => [row.pos, row.carrier_count, row.total_cases])).toEqual([
        [100, 1, 1],
        [500, 1, 1]
      ])
      expect(service.cohort.getCarriers({ chr: '1', pos: 100, ref: 'A', alt: 'G', variant_type: 'snv', genome_build: 'GRCh38' }).map((c) => c.case_name)).toEqual([
        'ready'
      ])
    })

    it('cohort extension-column filter (EXISTS over variants)', () => {
      // Only the provisional case has support >= 50 at this coordinate.
      const cohort = service.cohort.getCohortVariants({
        page: 1,
        items_per_page: 50,
        column_filters: { 'sv.support': { operator: '>=', value: 50 } }
      } as never)
      expect(cohort.data).toEqual([])
    })

    it('internal allele frequency: denominator of the max_internal_af filter', () => {
      expect(countCasesForInternalAf(db(), service.kysely, { max_internal_af: 0.5 } as never)).toBe(
        1
      )
    })

    it('internal allele frequency: a full recount of the numerators', () => {
      new VariantFrequencyService(db()).recomputeAllFrequencies()
      expect(frequencies()).toEqual([
        { pos: 100, case_count: 1 },
        { pos: 500, case_count: 1 }
      ])
    })
  })

  describe('bookkeeping that must see it', () => {
    it('duplicate-name checks', () => {
      expect(service.cases.getCaseByName('in-flight').id).toBe(provisionalId)
      expect(service.cases.getExistingCaseNames(['in-flight', 'ready', 'nope'])).toEqual(
        new Set(['in-flight', 'ready'])
      )
    })

    it('lookup by id', () => {
      expect(service.cases.getCase(provisionalId).name).toBe('in-flight')
    })

    it('delete by id, without taking back frequencies it never counted', async () => {
      const before = frequencies()

      const result = await deleteCasesIncrementally(db(), [provisionalId], {
        deletingAll: false,
        isCancelled: () => false,
        onProgress: () => undefined
      })

      expect(result).toEqual({ deleted: 1, cancelled: false })
      expect(db().prepare('SELECT COUNT(*) AS c FROM variants').get()).toEqual({ c: 2 })
      expect(frequencies()).toEqual(before)
    })
  })
})
