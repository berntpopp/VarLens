import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { AssociationDataBuilder } from '../../../src/main/database/AssociationDataBuilder'
import { fisherExactTest } from '../../../src/main/statistics/fisher'
import { logisticBurdenTest } from '../../../src/main/statistics/burden'
import { benjaminiHochberg } from '../../../src/main/statistics/fdr'
import type { GeneAssociationResult } from '../../../src/main/statistics/types'

describe('Association analysis integration', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)

    const now = Date.now()

    // Insert 10 cases
    for (let i = 1; i <= 10; i++) {
      db.prepare(
        "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (?, ?, '/test', 100, 0, ?)"
      ).run(i, `case${i}`, now)
      db.prepare(
        'INSERT INTO case_metadata (case_id, affected_status, sex, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(i, i <= 5 ? 'affected' : 'unaffected', i % 2 === 0 ? 'male' : 'female', '', now, now)
    }

    // Group A (cases 1-5): 3 have BRCA1 variants, 2 have TP53
    // Group B (cases 6-10): 0 have BRCA1, 1 has TP53
    // -> BRCA1 should be significantly enriched in Group A

    // BRCA1 variants for cases 1, 2, 3
    for (const caseId of [1, 2, 3]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (?, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '1')"
      ).run(caseId)
    }

    // TP53 variants for cases 4, 5, 8
    for (const caseId of [4, 5, 8]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (?, 'chr17', 7579472, 'C', 'T', 'TP53', 'missense_variant', 0.01, 30.0, '1')"
      ).run(caseId)
    }

    // Noise gene: present in equal proportions
    for (const caseId of [1, 3, 6, 8]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (?, 'chr7', 55181378, 'G', 'A', 'EGFR', 'synonymous_variant', 0.1, 10.0, '1')"
      ).run(caseId)
    }
  })

  it('detects BRCA1 enrichment with Fisher test', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], {}, [])

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')
    expect(brca1).toBeDefined()
    expect(brca1!.groupA_carrier_count).toBe(3)
    expect(brca1!.groupB_carrier_count).toBe(0)

    const fisher = fisherExactTest(
      brca1!.groupA_carrier_count,
      brca1!.groupB_carrier_count,
      brca1!.groupA_non_carrier_count,
      brca1!.groupB_non_carrier_count
    )
    expect(fisher.p_value).toBeLessThan(0.2)
  })

  it('runs full pipeline with FDR correction', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], {}, [])

    expect(genes.length).toBeGreaterThanOrEqual(2) // BRCA1 + TP53 + EGFR

    // Run Fisher for all genes
    const pValues: (number | null)[] = []
    for (const gene of genes) {
      const fisher = fisherExactTest(
        gene.groupA_carrier_count,
        gene.groupB_carrier_count,
        gene.groupA_non_carrier_count,
        gene.groupB_non_carrier_count
      )
      pValues.push(fisher.p_value)
    }

    // Apply FDR
    const qValues = benjaminiHochberg(pValues)
    expect(qValues.length).toBe(pValues.length)

    // EGFR (equal in both groups) should have higher q-value than BRCA1
    const brca1Idx = genes.findIndex((g) => g.gene_symbol === 'BRCA1')
    const egfrIdx = genes.findIndex((g) => g.gene_symbol === 'EGFR')
    if (brca1Idx >= 0 && egfrIdx >= 0) {
      const brca1Q = qValues[brca1Idx]
      const egfrQ = qValues[egfrIdx]
      if (brca1Q !== null && egfrQ !== null) {
        expect(brca1Q).toBeLessThan(egfrQ)
      }
    }
  })

  it('runs logistic burden test on gene data', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], {}, [])

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')!
    const result = logisticBurdenTest(brca1.samples, 'uniform')

    // Should produce a result (may use Firth due to small sample + separation)
    expect(result.p_value).not.toBeNull()
  })

  it('respects gnomAD AF filter', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], { gnomad_af_max: 0.005 }, [])

    // BRCA1 (AF=0.001) should pass, TP53 (AF=0.01) and EGFR (AF=0.1) should be filtered
    const geneNames = genes.map((g) => g.gene_symbol)
    expect(geneNames).toContain('BRCA1')
    expect(geneNames).not.toContain('EGFR')
  })

  it('handles covariates (sex)', () => {
    const builder = new AssociationDataBuilder(db)
    const genes = builder.build([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], {}, ['sex'])

    const brca1 = genes.find((g) => g.gene_symbol === 'BRCA1')!

    // All samples should have covariate values
    for (const sample of brca1.samples) {
      expect(sample.covariate_values.length).toBe(1)
      // Sex encoded as: male=1, female=0
      expect([0, 0.5, 1]).toContain(sample.covariate_values[0])
    }
  })
})

describe('AssociationEngine parallel execution', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)

    const now = Date.now()
    for (let i = 1; i <= 10; i++) {
      db.prepare(
        "INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at) VALUES (?, ?, '/test', 100, 0, ?)"
      ).run(i, `case${i}`, now)
      db.prepare(
        'INSERT INTO case_metadata (case_id, affected_status, sex, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(i, i <= 5 ? 'affected' : 'unaffected', 'male', '', now, now)
    }
    for (const caseId of [1, 2, 3]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (?, 'chr17', 41244000, 'A', 'G', 'BRCA1', 'missense_variant', 0.001, 25.0, '1')"
      ).run(caseId)
    }
    for (const caseId of [4, 5, 8]) {
      db.prepare(
        "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, gnomad_af, cadd, gt_num) VALUES (?, 'chr17', 7579472, 'C', 'T', 'TP53', 'missense_variant', 0.01, 30.0, '1')"
      ).run(caseId)
    }
  })

  it('delegates gene computation to WorkerPool', async () => {
    // Mock WorkerPool so tests don't need a compiled statistics-worker.js
    const mockResults: GeneAssociationResult[] = [
      {
        gene_symbol: 'BRCA1',
        n_variants: 1,
        groupA_carriers: 3,
        groupB_carriers: 0,
        groupA_total: 5,
        groupB_total: 5,
        fisher: { p_value: 0.05, odds_ratio: null, ci_lower: null, ci_upper: null },
        logistic_burden: {
          p_value: 0.1,
          beta: null,
          se: null,
          ci_lower: null,
          ci_upper: null,
          used_firth: false
        }
      }
    ]

    const mockRun = vi.fn().mockResolvedValue(mockResults)
    vi.resetModules()
    vi.doMock('../../../src/main/statistics/WorkerPool', () => {
      function WorkerPool() {
        return { run: mockRun, abort: vi.fn() }
      }
      return { WorkerPool }
    })

    // Re-import after mock is set up
    const { AssociationEngine } = await import('../../../src/main/statistics/AssociationEngine')

    const engine = new AssociationEngine(db)

    const config = {
      groupA_ids: [1, 2, 3, 4, 5],
      groupB_ids: [6, 7, 8, 9, 10],
      primary_test: 'fisher' as const,
      weight_scheme: 'uniform' as const,
      covariates: [],
      filters: {},
      max_threads: 2
    }

    const results = await engine.run(config)

    // WorkerPool.run should have been called with the gene data
    expect(mockRun).toHaveBeenCalledOnce()
    const [genesArg, weightSchemeArg] = mockRun.mock.calls[0]
    expect(genesArg.length).toBeGreaterThan(0)
    expect(weightSchemeArg).toBe('uniform')

    // Results should include FDR-corrected output from the mocked worker results
    expect(results.results.length).toBe(1)
    expect(results.results[0].gene_symbol).toBe('BRCA1')
    expect(results.results[0].q_value).not.toBeNull()
    expect(results.primary_test).toBe('fisher')
  })

  it('propagates abort to WorkerPool', async () => {
    const mockAbort = vi.fn()
    let engineRef: { abort: () => void } | null = null
    const mockRun = vi.fn().mockImplementation(async () => {
      // Simulate mid-run abort: engine.abort() is called while pool.run() is awaited
      engineRef?.abort()
      return []
    })

    vi.resetModules()
    vi.doMock('../../../src/main/statistics/WorkerPool', () => {
      function WorkerPool() {
        return { run: mockRun, abort: mockAbort }
      }
      return { WorkerPool }
    })

    const { AssociationEngine } = await import('../../../src/main/statistics/AssociationEngine')
    const engine = new AssociationEngine(db)
    engineRef = engine

    const config = {
      groupA_ids: [1, 2, 3, 4, 5],
      groupB_ids: [6, 7, 8, 9, 10],
      primary_test: 'fisher' as const,
      weight_scheme: 'uniform' as const,
      covariates: [],
      filters: {},
      max_threads: 1
    }

    const results = await engine.run(config)

    // abort() should have been forwarded to the pool
    expect(mockAbort).toHaveBeenCalled()
    expect(results.warnings).toContain('Analysis cancelled')
  })
})
