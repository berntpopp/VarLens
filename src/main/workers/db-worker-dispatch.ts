/**
 * db-worker-dispatch — pure task dispatcher extracted from db-worker.ts.
 *
 * Contains the switch-based dispatch logic, the PanelAwareFilter interface,
 * and the resolvePanelIntervalsInPlace helper. All external dependencies
 * (db, repos, geneRefDb) are injected via DispatchDependencies so the
 * module is independently testable without worker-thread infrastructure.
 */

import type { Repositories } from '../database/createRepositories'
import type { GeneReferenceDb } from '../database/GeneReferenceDb'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { DbTask } from '../../shared/types/db-task'
import { AssociationDataBuilder } from '../database/AssociationDataBuilder'
import type { VariantFilters } from '../statistics/types'
import type { VariantFilter } from '../database/types'
import { convertBigInts } from '../utils/convertBigInts'

/** Dependencies injected by the caller (db-worker or tests) */
export interface DispatchDependencies {
  db: DatabaseType
  repos: Repositories
  geneRefDb: GeneReferenceDb | null
}

/** Minimal shape for a filter object that may carry panel IPC fields */
export interface PanelAwareFilter {
  active_panel_ids?: number[]
  panel_padding_bp?: number
  genome_build?: string
  panel_intervals?: Array<{ chr: string; start: number; end: number }>
  [key: string]: unknown
}

/**
 * Resolve panel intervals within the worker thread so the main thread
 * is not blocked by the computation.
 *
 * Mutates `filter` in place: sets `panel_intervals` and removes
 * `active_panel_ids` / `panel_padding_bp` / `genome_build` so the
 * repository does not see IPC-only fields.
 *
 * No-op when the gene reference DB is unavailable.
 *
 * @param filter    Query filter object (variants or cohort)
 * @param repos     Repository collection (for variant chr-prefix detection)
 * @param geneRefDb Gene reference database (for panel interval computation)
 * @param db        Raw database handle (for cohort-mode chr-prefix detection)
 * @param caseId    When set, chr prefix is derived from the specified case.
 *                  Omit for cohort mode — a sample variant row is queried instead.
 */
export function resolvePanelIntervalsInPlace(
  filter: PanelAwareFilter,
  repos: Repositories,
  geneRefDb: GeneReferenceDb | null,
  db: DatabaseType,
  caseId?: number
): void {
  const panelIds = filter.active_panel_ids
  if (panelIds === undefined || panelIds.length === 0 || geneRefDb === null) {
    delete filter.active_panel_ids
    delete filter.panel_padding_bp
    delete filter.genome_build
    return
  }

  const paddingBp = filter.panel_padding_bp ?? 5000
  const genomeBuild = filter.genome_build ?? 'GRCh38'

  // Detect chr prefix
  const chrPrefix: boolean =
    caseId !== undefined
      ? repos.variants.getChrPrefix(caseId)
      : (() => {
          // Cohort mode: sample any variant to detect chr prefix.
          // Assumes uniform format — mixed chr/non-chr imports are unsupported.
          const sampleRow = db.prepare('SELECT chr FROM variants LIMIT 1').get() as
            | { chr: string }
            | undefined
          return sampleRow?.chr?.startsWith('chr') === true
        })()

  try {
    const intervals = repos.panels.computeIntervals(
      panelIds,
      genomeBuild,
      paddingBp,
      geneRefDb,
      chrPrefix
    )
    if (intervals.length > 0) {
      filter.panel_intervals = intervals
    }
  } catch (e) {
    console.warn(
      '[db-worker] Panel interval computation failed (proceeding without panel filtering):',
      e instanceof Error ? e.message : String(e)
    )
  }

  delete filter.active_panel_ids
  delete filter.panel_padding_bp
  delete filter.genome_build
}

/**
 * Dispatch a single DbTask to the appropriate repository method.
 *
 * This is the pure logic extracted from db-worker.ts's `run()` function.
 * All state (db, repos, geneRefDb) is provided via deps.
 */
export function dispatchTask(deps: DispatchDependencies, task: DbTask): unknown {
  const { db, repos, geneRefDb } = deps
  const { type, params } = task

  try {
    switch (type) {
      // ── Variants ──────────────────────────────────────────
      case 'variants:query': {
        const filter = params[0] as PanelAwareFilter & VariantFilter
        // Resolve panel intervals off the main thread (no-op when gene ref DB unavailable)
        if ((filter.active_panel_ids?.length ?? 0) > 0) {
          resolvePanelIntervalsInPlace(filter, repos, geneRefDb, db, filter.case_id)
        }
        return repos.variants.getVariants(
          filter,
          params[1] as number,
          params[2] as number,
          params[3] as Parameters<typeof repos.variants.getVariants>[3],
          params[4] as boolean | undefined,
          params[5] as boolean | undefined
        )
      }

      case 'variants:filterOptions':
        return repos.variants.getFilterOptions(params[0] as number)

      case 'variants:search':
        return repos.variants.searchVariants(
          params[0] as number,
          params[1] as string,
          params[2] as number
        )

      case 'variants:geneSymbols':
        return repos.variants.getGeneSymbols(
          params[0] as number,
          params[1] as string,
          params[2] as number
        )

      // ── Cohort ────────────────────────────────────────────
      case 'cohort:variants': {
        const cohortParams = params[0] as PanelAwareFilter &
          Parameters<typeof repos.cohort.getCohortVariants>[0]
        // Resolve panel intervals off the main thread (cohort mode: no specific case)
        if ((cohortParams.active_panel_ids?.length ?? 0) > 0) {
          resolvePanelIntervalsInPlace(cohortParams, repos, geneRefDb, db)
        }
        return repos.cohort.getCohortVariants(cohortParams)
      }

      case 'cohort:columnMeta':
        return repos.cohort.getColumnMeta()

      case 'cohort:summary':
        return repos.cohort.getCohortSummary()

      case 'cohort:carriers':
        return repos.cohort.getCarriers(
          params[0] as string,
          params[1] as number,
          params[2] as string,
          params[3] as string
        )

      case 'cohort:geneBurden':
        return repos.cohort.getGeneBurden()

      case 'cohort:summaryStatus':
        return repos.cohortSummary.getStatus()

      // ── Cases ─────────────────────────────────────────────
      case 'cases:list':
        return repos.cases.getAllCases()

      case 'cases:query':
        return repos.cases.queryCases(params[0] as Parameters<typeof repos.cases.queryCases>[0])

      // ── Annotations ───────────────────────────────────────
      case 'annotations:getGlobal':
        return repos.annotations.getGlobalAnnotation(
          params[0] as string,
          params[1] as number,
          params[2] as string,
          params[3] as string
        )

      case 'annotations:getPerCase':
        return repos.annotations.getPerCaseAnnotation(params[0] as number, params[1] as number)

      case 'annotations:getForVariant':
        return repos.annotations.getAnnotationsForVariant(
          params[0] as number,
          params[1] as string,
          params[2] as number,
          params[3] as string,
          params[4] as string
        )

      case 'annotations:batchGet':
        return repos.annotations.getBatch(
          params[0] as number | null,
          params[1] as Array<{ chr: string; pos: number; ref: string; alt: string }>
        )

      // ── Case Metadata ────────────────────────────────────
      case 'case-metadata:get':
        return repos.metadata.getCaseMetadata(params[0] as number)

      case 'case-metadata:listCohorts':
        return repos.metadata.listCohortGroups()

      case 'case-metadata:getCohortByName':
        return repos.metadata.getCohortGroupByName(params[0] as string)

      case 'case-metadata:getCaseCohorts':
        return repos.metadata.getCaseCohorts(params[0] as number)

      case 'case-metadata:getHpoTerms':
        return repos.metadata.getCaseHpoTerms(params[0] as number)

      case 'case-metadata:getDataInfo':
        return repos.metadata.getCaseDataInfo(params[0] as number)

      case 'case-metadata:listExternalIds':
        return repos.metadata.listCaseExternalIds(params[0] as number)

      case 'case-metadata:distinctPlatforms':
        return repos.metadata.getDistinctPlatforms()

      case 'case-metadata:distinctExternalIdTypes':
        return repos.metadata.getDistinctExternalIdTypes()

      case 'case-metadata:distinctHpoTerms':
        return repos.metadata.getDistinctHpoTerms()

      case 'case-metadata:getFullMetadata':
        return repos.metadata.getFullCaseMetadata(params[0] as number)

      // ── Association analysis ─────────────────────────────
      case 'association:build': {
        const builder = new AssociationDataBuilder(db)
        return builder.build(
          params[0] as number[],
          params[1] as number[],
          params[2] as VariantFilters,
          params[3] as string[]
        )
      }

      // ── Tags ──────────────────────────────────────────────
      case 'tags:list':
        return repos.tags.listTags()

      case 'tags:getVariantTags':
        return repos.tags.getVariantTags(
          params[0] as number, // caseId
          params[1] as number // variantId
        )

      case 'tags:getUsageCount':
        return repos.tags.getTagUsageCount(params[0] as number) // tagId

      // ── Transcripts ───────────────────────────────────────
      case 'transcripts:list':
        return repos.transcripts.getVariantTranscripts(params[0] as number) // variantId

      // ── Gene Lists ────────────────────────────────────────
      case 'gene-lists:list':
        return repos.geneLists.listGeneLists()

      case 'gene-lists:getGenes':
        return repos.geneLists.getGeneListGenes(params[0] as number) // geneListId

      // ── Region Files ──────────────────────────────────────
      case 'region-files:list':
        return repos.geneLists.listRegionFiles()

      // ── Database ──────────────────────────────────────────
      case 'database:overview': {
        const overview = repos.overview.getDatabaseOverview()
        return convertBigInts(overview)
      }

      default:
        throw new Error(`Unknown db-worker task type: ${type}`)
    }
  } catch (error) {
    // Convert any custom error classes to plain Error for structured clone transfer
    if (error instanceof Error) {
      const plain = new Error(error.message)
      plain.stack = error.stack
      throw plain
    }
    throw error
  }
}
