import type { Pool } from 'pg'

import type { Case } from '../../../shared/types/database'
import { quoteIdentifier } from './identifiers'
import { runNamed } from './named-query'

export class PostgresCaseListRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string
  ) {}

  async listCases(): Promise<Case[]> {
    const schemaName = quoteIdentifier(this.schema)
    const query = `
      SELECT
        id,
        name,
        file_path,
        file_size,
        variant_count,
        created_at,
        genome_build
      FROM ${schemaName}."cases"
      ORDER BY created_at DESC
    `

    const result = await runNamed(this.pool, {
      name: 'cases:list_all:v1',
      text: query,
      values: [],
      schema: this.schema
    })

    return result.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      file_path: String(row.file_path),
      file_size: Number(row.file_size),
      variant_count: Number(row.variant_count),
      created_at: Number(row.created_at),
      genome_build: String(row.genome_build)
    }))
  }
}
