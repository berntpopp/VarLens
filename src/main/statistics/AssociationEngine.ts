import type {
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult,
  GeneAssociationResultWithFDR
} from './types'
import { AssociationDataBuilder } from '../database/AssociationDataBuilder'
import { benjaminiHochberg } from './fdr'
import { WorkerPool } from './WorkerPool'
import type Database from 'better-sqlite3-multiple-ciphers'

/**
 * Main orchestrator for association analysis.
 * Distributes gene-level statistical tests across worker threads
 * using WorkerPool for parallel computation.
 */
export class AssociationEngine {
  private db: Database.Database
  private onProgress?: (completed: number, total: number) => void
  private pool: WorkerPool | null = null
  private aborted = false

  constructor(db: Database.Database, onProgress?: (completed: number, total: number) => void) {
    this.db = db
    this.onProgress = onProgress
  }

  async run(config: AssociationConfig): Promise<AssociationResults> {
    const start = Date.now()
    const warnings: string[] = []
    this.aborted = false

    // 1. Build per-gene contingency data
    const builder = new AssociationDataBuilder(this.db)
    const genes = builder.build(
      config.groupA_ids,
      config.groupB_ids,
      config.filters,
      config.covariates
    )

    if (genes.length === 0) {
      return {
        results: [],
        primary_test: config.primary_test,
        config,
        warnings: ['No genes with qualifying variants'],
        elapsed_ms: Date.now() - start
      }
    }

    // 2. Run tests in parallel across worker threads
    this.pool = new WorkerPool(config.max_threads > 0 ? config.max_threads : undefined)
    let rawResults: GeneAssociationResult[]
    try {
      rawResults = await this.pool.run(genes, config.weight_scheme, this.onProgress)
    } finally {
      this.pool = null
    }

    if (this.aborted) {
      return {
        results: [],
        primary_test: config.primary_test,
        config,
        warnings: ['Analysis cancelled'],
        elapsed_ms: Date.now() - start
      }
    }

    // Collect warnings from logistic burden results
    for (const result of rawResults) {
      if (result.logistic_burden.warning !== undefined && result.logistic_burden.warning !== '') {
        warnings.push(`${result.gene_symbol}: ${result.logistic_burden.warning}`)
      }
    }

    // 3. Apply FDR correction
    const pValues = rawResults.map((r) => {
      if (config.primary_test === 'fisher') return r.fisher.p_value
      return r.logistic_burden.p_value
    })
    const qValues = benjaminiHochberg(pValues)

    const results: GeneAssociationResultWithFDR[] = rawResults.map((r, i) => ({
      ...r,
      q_value: qValues[i]
    }))

    // Sort by primary test p-value
    results.sort((a, b) => {
      const pa = config.primary_test === 'fisher' ? a.fisher.p_value : a.logistic_burden.p_value
      const pb = config.primary_test === 'fisher' ? b.fisher.p_value : b.logistic_burden.p_value
      if (pa === null) return 1
      if (pb === null) return -1
      return pa - pb
    })

    return {
      results,
      primary_test: config.primary_test,
      config,
      warnings,
      elapsed_ms: Date.now() - start
    }
  }

  abort(): void {
    this.aborted = true
    this.pool?.abort()
  }
}
