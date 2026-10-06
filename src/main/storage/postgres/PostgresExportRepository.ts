import type { Pool, PoolClient } from 'pg'
import QueryStream from 'pg-query-stream'

import type { VariantFilter } from '../../../shared/types/database'
import { quoteIdentifier } from './identifiers'
import { PostgresPanelIntervalResolver } from './postgres-panel-interval-resolver'
import { buildPostgresVariantQueryParts } from './PostgresVariantReadRepository'

type ExportPool = Pick<Pool, 'connect' | 'query'>
type ExportClient = Pick<PoolClient, 'query' | 'release'>

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
    const client: ExportClient = await this.pool.connect()
    const stream = client.query(
      new QueryStream(
        `SELECT ${projections.join(', ')}
         ${fromAndWhereSql}
         ${orderBySql}`,
        params
      )
    ) as AsyncIterable<Record<string, unknown>>

    try {
      for await (const row of stream) {
        yield row
      }
    } finally {
      client.release()
    }
  }
}
