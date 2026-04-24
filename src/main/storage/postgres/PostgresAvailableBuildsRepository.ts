import type { Pool } from 'pg'

import type { AvailableBuild } from '../../../shared/types/database'
import { quoteIdentifier } from './identifiers'

interface AvailableBuildRow {
  build: unknown
  case_count: unknown
}

export class PostgresAvailableBuildsRepository {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly schema: string
  ) {}

  async getAvailableGenomeBuilds(): Promise<AvailableBuild[]> {
    const schemaName = quoteIdentifier(this.schema)
    const query = `
      SELECT
        COALESCE(genome_build, 'GRCh38') AS build,
        COUNT(*)::int AS case_count
      FROM ${schemaName}."cases"
      GROUP BY 1
      ORDER BY case_count DESC
    `

    const result = await this.pool.query<AvailableBuildRow>(query)

    return result.rows.map((row) => ({
      build: row.build === null || row.build === undefined ? 'GRCh38' : String(row.build),
      caseCount: Number(row.case_count)
    }))
  }
}
