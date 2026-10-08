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
    // Same panel-region resolution as the on-screen query, so an export under
    // an active gene panel contains exactly the rows the table shows.
    const filter = await this.panelIntervals.resolveCaseFilter(requestedFilter)
    const { fromAndWhereSql, orderBySql, params, projections } = buildPostgresVariantQueryParts(
      filter,
      this.schemaName
    )
    yield* streamLongQuery(
      this.pool,
      `SELECT ${projections.join(', ')}
         ${fromAndWhereSql}
         ${orderBySql}`,
      params
    )
  }
}
