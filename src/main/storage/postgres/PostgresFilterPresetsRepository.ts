import type { Pool, QueryResult, QueryResultRow } from 'pg'

import { DatabaseError, NotFoundError, UniqueConstraintError } from '../../database/errors'
import type {
  FilterPreset,
  FilterPresetCreate,
  FilterPresetKind,
  FilterPresetUpdate
} from '../../../shared/types/filter-presets'
import { quoteIdentifier } from './identifiers'
import { runNamed } from './named-query'
import { withTransaction, type TransactionCapablePool } from './transaction'

interface PresetRow extends QueryResultRow {
  id: unknown
  name: unknown
  description: unknown
  filter_json: unknown
  kind?: unknown
  is_built_in: unknown
  is_visible: unknown
  sort_order: unknown
  created_at: unknown
  updated_at: unknown
}

type Queryable = Pick<Pool, 'query'>
type TransactionPool = Pick<Pool, 'connect'>
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

function rowToPreset(row: PresetRow): FilterPreset {
  const kind: FilterPresetKind = row.kind === 'shortlist' ? 'shortlist' : 'filter'

  return {
    id: Number(row.id),
    name: String(row.name),
    description:
      row.description === null || row.description === undefined ? null : String(row.description),
    filterJson: JSON.parse(String(row.filter_json)),
    kind,
    isBuiltIn: toBoolean(row.is_built_in),
    isVisible: toBoolean(row.is_visible),
    sortOrder: Number(row.sort_order),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export class PostgresFilterPresetsRepository {
  private readonly schemaName: string
  private readonly schema: string

  constructor(
    private readonly pool: Queryable & Partial<TransactionPool>,
    schema: string
  ) {
    this.schema = schema
    this.schemaName = quoteIdentifier(schema)
  }

  async listPresets(): Promise<FilterPreset[]> {
    const result = await runNamed<PresetRow>(this.pool as Pool, {
      name: 'filter_presets:list:v1',
      text: `
      SELECT *
      FROM ${this.tableName()}
      ORDER BY sort_order, name
    `,
      values: [],
      schema: this.schema
    })

    return result.rows.map(rowToPreset)
  }

  async getPreset(id: number): Promise<FilterPreset | null> {
    const row = await this.getPresetRow(id)
    return row ? rowToPreset(row) : null
  }

  async createPreset(params: FilterPresetCreate): Promise<FilterPreset> {
    try {
      const now = Date.now()
      const kind: FilterPresetKind = params.kind ?? 'filter'
      const result = await runNamed<PresetRow>(this.pool as Pool, {
        name: 'filter_presets:create:v1',
        text: `
          INSERT INTO ${this.tableName()}
            (name, description, filter_json, kind, is_built_in, is_visible, sort_order, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        values: [
          params.name,
          params.description ?? null,
          JSON.stringify(params.filterJson),
          kind,
          0,
          params.isVisible === false ? 0 : 1,
          params.sortOrder ?? 0,
          now,
          now
        ],
        schema: this.schema
      })

      return rowToPreset(firstRow(result))
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError('name', params.name)
      }
      throw new DatabaseError(
        `Failed to create preset: ${params.name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async updatePreset(id: number, updates: FilterPresetUpdate): Promise<FilterPreset> {
    try {
      const existing = await this.getPresetRow(id)
      if (!existing) throw new NotFoundError('FilterPreset', id)

      const values: Array<string | number | boolean | null> = []
      const assignments: string[] = []
      const addAssignment = (column: string, value: string | number | boolean | null): void => {
        values.push(value)
        assignments.push(`${quoteIdentifier(column)} = $${values.length}`)
      }

      if (toBoolean(existing.is_built_in)) {
        if (updates.isVisible !== undefined) addAssignment('is_visible', updates.isVisible ? 1 : 0)
        if (updates.sortOrder !== undefined) addAssignment('sort_order', updates.sortOrder)
      } else {
        if (updates.name !== undefined) addAssignment('name', updates.name)
        if (updates.description !== undefined)
          addAssignment('description', updates.description ?? null)
        if (updates.filterJson !== undefined)
          addAssignment('filter_json', JSON.stringify(updates.filterJson))
        if (updates.kind !== undefined) addAssignment('kind', updates.kind)
        if (updates.isVisible !== undefined) addAssignment('is_visible', updates.isVisible ? 1 : 0)
        if (updates.sortOrder !== undefined) addAssignment('sort_order', updates.sortOrder)
      }

      addAssignment('updated_at', Date.now())
      values.push(id)

      const result = await this.pool.query<PresetRow>(
        `
          UPDATE ${this.tableName()}
          SET ${assignments.join(', ')}
          WHERE id = $${values.length}
          RETURNING *
        `,
        values
      )

      return rowToPreset(firstRow(result))
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError('name', updates.name ?? '')
      }
      throw new DatabaseError(
        `Failed to update preset: ${id}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async deletePreset(id: number): Promise<void> {
    const existing = await this.getPresetRow(id)
    if (!existing) throw new NotFoundError('FilterPreset', id)
    if (toBoolean(existing.is_built_in)) {
      throw new DatabaseError('Cannot delete built-in preset')
    }

    await this.pool.query(`DELETE FROM ${this.tableName()} WHERE id = $1`, [id])
  }

  async reorderPresets(items: { id: number; sortOrder: number }[]): Promise<void> {
    if (typeof this.pool.connect !== 'function') {
      throw new DatabaseError('Postgres pool does not support transactions')
    }

    await withTransaction(this.pool as TransactionCapablePool, async (client) => {
      const now = Date.now()
      for (const item of items) {
        await client.query(
          `UPDATE ${this.tableName()} SET sort_order = $1, updated_at = $2 WHERE id = $3`,
          [item.sortOrder, now, item.id]
        )
      }
    })
  }

  private async getPresetRow(id: number): Promise<PresetRow | null> {
    const result = await this.pool.query<PresetRow>(
      `SELECT * FROM ${this.tableName()} WHERE id = $1`,
      [id]
    )
    return result.rows[0] ?? null
  }

  private tableName(): string {
    return `${this.schemaName}."filter_presets"`
  }
}

function firstRow(result: QueryResult<PresetRow>): PresetRow {
  const row = result.rows[0]
  if (row === undefined) {
    throw new DatabaseError('Postgres query returned no rows')
  }
  return row
}
