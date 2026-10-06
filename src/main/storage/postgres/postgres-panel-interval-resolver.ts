/**
 * PostgreSQL gene-panel region resolver (issue #447).
 *
 * Turns the IPC-level panel request on a filter (`active_panel_ids` +
 * `panel_padding_bp`) into concrete `panel_intervals` — panel gene coordinates
 * for the relevant genome build, widened by the padding — before any SQL is
 * built. It is the PostgreSQL counterpart of `resolvePanelIntervalsInPlace`
 * (`db-worker-dispatch.ts`) / `computePanelIntervals` (`panelIntervalHelper.ts`)
 * and shares their region arithmetic through `shared/filters/panel-intervals`.
 *
 * One resolver serves every PostgreSQL read path that filters by panel: the
 * single-case query (and therefore the shortlist, which queries through it),
 * the single-case export, the cohort query and the cohort export.
 *
 * Contract (same as `panelIntervalHelper.ts`):
 * - No panel requested → the filter is returned without panel fields.
 * - Panel requested but it yields no regions (no genes, or no coordinates in
 *   that build) → no restriction, exactly as on SQLite.
 * - Resolution FAILS (gene reference unavailable, query error) → the error
 *   propagates. A failed resolution must never look like "no panel" (silently
 *   wider) or like "panel matched nothing" (silently narrower).
 */
import type { Pool } from 'pg'

import {
  buildPaddedPanelIntervals,
  DEFAULT_PANEL_GENOME_BUILD,
  DEFAULT_PANEL_PADDING_BP
} from '../../../shared/filters/panel-intervals'
import type { CohortSearchParams } from '../../../shared/types/cohort'
import type { VariantFilter } from '../../../shared/types/database'
import type { GenomicInterval } from '../../../shared/types/panels'
import { getGeneReferenceDb } from '../../database/geneReferenceLoader'
import { mainLogger } from '../../services/MainLogger'
import { quoteIdentifier } from './identifiers'

/** Computes the regions for a set of panels; injectable for tests. */
export type PanelIntervalLookup = (
  panelIds: number[],
  genomeBuild: string,
  paddingBp: number,
  chrPrefix: boolean
) => Promise<GenomicInterval[]>

interface PanelRequest {
  active_panel_ids?: number[]
  panel_padding_bp?: number
  panel_intervals?: GenomicInterval[]
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

/** Drop the IPC-only panel request fields; they must never reach a SQL builder. */
function withoutPanelRequest<T extends PanelRequest>(filter: T): T {
  const rest = { ...filter }
  delete rest.active_panel_ids
  delete rest.panel_padding_bp
  return rest
}

export class PostgresPanelIntervalResolver {
  private readonly schemaName: string
  private readonly lookup: PanelIntervalLookup

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string,
    lookup?: PanelIntervalLookup
  ) {
    this.schemaName = quoteIdentifier(schema)
    this.lookup = lookup ?? this.lookupFromGeneReference.bind(this)
  }

  /**
   * Resolve the panel request of a single-case filter. Regions use the genome
   * build and chromosome naming of the case being queried.
   */
  async resolveCaseFilter(filter: VariantFilter): Promise<VariantFilter> {
    return this.resolve(filter, 'variants', async () => {
      const result = await this.pool.query<{ genome_build: string | null; chr: string | null }>(
        `SELECT
           (SELECT c.genome_build FROM ${this.schemaName}."cases" c WHERE c.id = $1) AS genome_build,
           (SELECT v.chr FROM ${this.schemaName}."variants" v WHERE v.case_id = $1 LIMIT 1) AS chr`,
        [filter.case_id]
      )
      const row = result.rows[0]
      const requestedBuild = (filter as VariantFilter & { genome_build?: string }).genome_build
      return {
        genomeBuild:
          requestedBuild !== undefined && requestedBuild !== ''
            ? requestedBuild
            : (row?.genome_build ?? DEFAULT_PANEL_GENOME_BUILD),
        chrPrefix: row?.chr?.startsWith('chr') ?? false
      }
    })
  }

  /**
   * Resolve the panel request of a cohort query. Regions use the cohort's
   * selected genome build; chromosome naming is sampled from any variant
   * (mixed `chr7` / `7` imports are unsupported, as on SQLite).
   */
  async resolveCohortParams(params: CohortSearchParams): Promise<CohortSearchParams> {
    return this.resolve(params, 'cohort', async () => {
      const result = await this.pool.query<{ chr?: string }>(
        `SELECT chr FROM ${this.schemaName}."variants" LIMIT 1`
      )
      return {
        genomeBuild:
          params.genome_build !== undefined && params.genome_build !== ''
            ? params.genome_build
            : DEFAULT_PANEL_GENOME_BUILD,
        chrPrefix: result.rows[0]?.chr?.startsWith('chr') ?? false
      }
    })
  }

  private async resolve<T extends PanelRequest>(
    filter: T,
    source: 'variants' | 'cohort',
    readContext: () => Promise<{ genomeBuild: string; chrPrefix: boolean }>
  ): Promise<T> {
    // Already-resolved regions win; the request fields are then redundant.
    if (isNonEmptyArray(filter.panel_intervals)) return withoutPanelRequest(filter)

    const panelIds = (filter.active_panel_ids ?? []).filter(
      (id): id is number => typeof id === 'number'
    )
    if (panelIds.length === 0) return withoutPanelRequest(filter)

    try {
      const { genomeBuild, chrPrefix } = await readContext()
      const intervals = await this.lookup(
        panelIds,
        genomeBuild,
        filter.panel_padding_bp ?? DEFAULT_PANEL_PADDING_BP,
        chrPrefix
      )
      const resolved = withoutPanelRequest(filter)
      if (intervals.length > 0) resolved.panel_intervals = intervals
      return resolved
    } catch (error) {
      mainLogger.error(
        `Failed to resolve PostgreSQL panel intervals for active gene panel(s): ${error instanceof Error ? error.message : String(error)}`,
        source
      )
      throw error
    }
  }

  private async lookupFromGeneReference(
    panelIds: number[],
    genomeBuild: string,
    paddingBp: number,
    chrPrefix: boolean
  ): Promise<GenomicInterval[]> {
    const panelResult = await this.pool.query<{ hgnc_id: string }>(
      `SELECT DISTINCT hgnc_id
       FROM ${this.schemaName}."panel_genes"
       WHERE panel_id = ANY($1::bigint[])`,
      [panelIds]
    )
    const hgncIds = panelResult.rows.map((row) => row.hgnc_id)
    if (hgncIds.length === 0) return []

    const coordinates = getGeneReferenceDb().getCoordinatesForGenes(hgncIds, genomeBuild)
    return buildPaddedPanelIntervals(coordinates.values(), paddingBp, chrPrefix)
  }
}
