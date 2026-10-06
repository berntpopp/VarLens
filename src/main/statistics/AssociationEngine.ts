import type {
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult,
  GeneContingencyData
} from './types'
import { AssociationDataBuilder } from '../database/AssociationDataBuilder'
import { emptyAssociationResults, finalizeAssociationResults } from './finalize'
import { WorkerPool } from './WorkerPool'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { DbPool } from '../database/DbPool'

/**
 * Main orchestrator for association analysis.
 * Distributes gene-level statistical tests across worker threads
 * using WorkerPool for parallel computation.
 *
 * When a DbPool is provided, the data-building step (heavy SQL + JS grouping)
 * runs off the main Electron thread via the Piscina worker pool.
 */
export class AssociationEngine {
  private db: Database.Database
  private onProgress?: (completed: number, total: number) => void
  private pool: WorkerPool | null = null
  private dbPool: DbPool | null
  private aborted = false

  constructor(
    db: Database.Database,
    onProgress?: (completed: number, total: number) => void,
    dbPool?: DbPool | null
  ) {
    this.db = db
    this.onProgress = onProgress
    this.dbPool = dbPool ?? null
  }

  async run(config: AssociationConfig): Promise<AssociationResults> {
    const start = Date.now()
    this.aborted = false

    // 1. Build per-gene contingency data (off main thread when pool available)
    let genes: GeneContingencyData[]
    if (this.dbPool) {
      genes = await this.dbPool.run<GeneContingencyData[]>({
        type: 'association:build',
        params: [config.groupA_ids, config.groupB_ids, config.filters, config.covariates]
      })
    } else {
      const builder = new AssociationDataBuilder(this.db)
      genes = builder.build(config.groupA_ids, config.groupB_ids, config.filters, config.covariates)
    }

    if (genes.length === 0) {
      return emptyAssociationResults(config, 'No genes with qualifying variants', start)
    }

    // Check abort after the (potentially async) build step completes
    if (this.aborted) return emptyAssociationResults(config, 'Analysis cancelled', start)

    // 2. Run tests in parallel across worker threads
    this.pool = new WorkerPool(config.max_threads > 0 ? config.max_threads : undefined)
    let rawResults: GeneAssociationResult[]
    try {
      rawResults = await this.pool.run(genes, config.weight_scheme, this.onProgress)
    } finally {
      this.pool = null
    }

    if (this.aborted) return emptyAssociationResults(config, 'Analysis cancelled', start)

    // 3. Warnings, FDR correction and sorting (shared with the web runner)
    return finalizeAssociationResults(rawResults, config, start)
  }

  abort(): void {
    this.aborted = true
    this.pool?.abort()
  }
}
