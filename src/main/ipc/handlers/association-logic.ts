/**
 * Backend-neutral gene-burden association run, used by the web server
 * (Postgres). Desktop keeps its worker-thread AssociationEngine; both share
 * the contingency builder, the per-gene tests and the FDR/sort tail, so the
 * numbers are identical.
 *
 * The per-gene tests run in-process here, yielding to the event loop between
 * small batches so a large run never blocks other requests on the server, and
 * checking the abort signal between batches.
 */
import { finalizeAssociationResults, emptyAssociationResults } from '../../statistics/finalize'
import { computeGeneAssociation } from '../../statistics/gene-tests'
import type {
  AssociationConfig,
  AssociationResults,
  GeneAssociationResult,
  AssociationBuildResult
} from '../../statistics/types'

const DEFAULT_BATCH_SIZE = 25

export interface InProcessAssociationOptions {
  signal?: AbortSignal
  onProgress?: (progress: { completed: number; total: number }) => void
  /** Genes per event-loop turn (tests use 1). */
  batchSize?: number
}

/** Same guard (and message) as the desktop handler. */
export function assertDisjointGroups(
  config: Pick<AssociationConfig, 'groupA_ids' | 'groupB_ids'>
): void {
  const groupA = new Set(config.groupA_ids)
  const overlap = config.groupB_ids.filter((id) => groupA.has(id))
  if (overlap.length > 0) {
    throw new Error(`Groups overlap: case IDs ${overlap.join(', ')} appear in both groups`)
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function runAssociationInProcess(
  config: AssociationConfig,
  buildData: (config: AssociationConfig) => Promise<AssociationBuildResult>,
  options: InProcessAssociationOptions = {}
): Promise<AssociationResults> {
  const startedAt = Date.now()
  assertDisjointGroups(config)

  const built = await buildData(config)
  const { genes, non_autosomal_variants } = built
  if (genes.length === 0) {
    return emptyAssociationResults(config, 'No genes with qualifying variants', startedAt, non_autosomal_variants)
  }

  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const raw: GeneAssociationResult[] = []
  for (let i = 0; i < genes.length; i++) {
    if (options.signal?.aborted === true) {
      return emptyAssociationResults(config, 'Analysis cancelled', startedAt, non_autosomal_variants)
    }
    // A failing gene is skipped, as in the desktop worker (which logs and continues).
    try {
      raw.push(computeGeneAssociation(genes[i], config.weight_scheme))
    } catch {
      // intentionally skipped: one degenerate gene must not fail the run
    }
    if ((i + 1) % batchSize === 0 || i === genes.length - 1) {
      options.onProgress?.({ completed: i + 1, total: genes.length })
      await yieldToEventLoop()
    }
  }

  if (options.signal?.aborted === true) {
    return emptyAssociationResults(config, 'Analysis cancelled', startedAt, non_autosomal_variants)
  }
  return finalizeAssociationResults(raw, config, startedAt, non_autosomal_variants)
}

/**
 * Cancel the caller's own run on a per-user run registry (web). Returns
 * whether a run was running; another user's run is never touched.
 */
export function cancelOwnAssociation(
  runs: { cancel: (userId: number) => boolean },
  userId: number
): boolean {
  return runs.cancel(userId)
}
