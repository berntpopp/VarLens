import type { Pool } from 'pg'

import type { VariantFilter } from '../../../shared/types/database'
import { quoteIdentifier } from './identifiers'
import { streamLongQuery } from './long-running-client'
import { PostgresPanelIntervalResolver } from './postgres-panel-interval-resolver'
import { buildPostgresVariantQueryParts } from './PostgresVariantReadRepository'

type ExportPool = Pick<Pool, 'connect' | 'query'>

export class PostgresExportRepository {
  private readonly schemaName: string

  private readonly panelIntervals: PostgresPanelIntervalResolver

  constructor(
    private readonly pool: ExportPool,
    schema: string,
    panelIntervals?: PostgresPanelIntervalResolver
  ) {
    this.schemaName = quoteIdentifier(schema)
    this.panelIntervals = panelIntervals ?? new PostgresPanelIntervalResolver(pool, schema)
  }

  async *streamVariantRows(
    requestedFilter: VariantFilter
  ): AsyncGenerator<Record<string, unknown>> {
    const { sql, params } = await this.variantRowsQuery(requestedFilter)
    yield* streamLongQuery(this.pool, sql, params)
  }

  /**
   * The variant-row query of a case filter (id ASC within the filter's
   * order), for callers that run it on their own client — the evidence
   * shortlist pages it through a cursor inside one snapshot.
   */
  async variantRowsQuery(
    requestedFilter: VariantFilter
  ): Promise<{ sql: string; params: unknown[] }> {
    // Same panel-region resolution as the on-screen query, so an export under
    // an active gene panel contains exactly the rows the table shows.
    const filter = await this.panelIntervals.resolveCaseFilter(requestedFilter)
    const { fromAndWhereSql, orderBySql, params, projections } = buildPostgresVariantQueryParts(
      filter,
      this.schemaName
    )
    return {
      sql: `SELECT ${projections.join(', ')}
         ${fromAndWhereSql}
         ${orderBySql}`,
      params
    }
  }
}
