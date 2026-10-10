import type { Pool } from 'pg'

import { DatabaseError, NotFoundError, UniqueConstraintError } from '../../database/errors'
import type { Tag } from '../../database/types'
import { quoteIdentifier } from './identifiers'
import { withTransaction, type TransactionCapablePool } from './transaction'

interface TagRow {
  id: unknown
  name: unknown
  color: unknown
  created_at: unknown
}

interface CountRow {
  count: unknown
}

type QueryPool = Pick<Pool, 'query'>
type TransactionPool = Pick<Pool, 'connect'>

export class PostgresTagsRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: QueryPool & Partial<TransactionPool>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async listTags(): Promise<Tag[]> {
    const result = await this.pool.query<TagRow>(
      `SELECT id, name, color, created_at FROM ${this.table('tags')} ORDER BY name`,
      []
    )

    return result.rows.map(toTag)
  }

  async createTag(name: string, color: string): Promise<Tag> {
    try {
      const result = await this.pool.query<TagRow>(
        `
          INSERT INTO ${this.table('tags')} (name, color, created_at)
          VALUES ($1, $2, $3)
          RETURNING id, name, color, created_at
        `,
        [name, color, Date.now()]
      )

      return toTag(result.rows[0])
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create tag: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async updateTag(id: number, updates: { name?: string; color?: string }): Promise<Tag> {
    try {
      const existing = await this.getRequiredTag(id)
      const setClauses: string[] = []
      const params: Array<string | number> = []

      if (updates.name !== undefined) {
        params.push(updates.name)
        setClauses.push(`name = $${params.length}`)
      }
      if (updates.color !== undefined) {
        params.push(updates.color)
        setClauses.push(`color = $${params.length}`)
      }

      if (setClauses.length === 0) {
        return existing
      }

      params.push(id)
      const result = await this.pool.query<TagRow>(
        `
          UPDATE ${this.table('tags')}
          SET ${setClauses.join(', ')}
          WHERE id = $${params.length}
          RETURNING id, name, color, created_at
        `,
        params
      )

      if (result.rows.length === 0) {
        throw new NotFoundError('Tag', id)
      }

      return toTag(result.rows[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (isUniqueViolation(error)) {
        throw new UniqueConstraintError('name', updates.name ?? '')
      }
      throw new DatabaseError(
        `Failed to update tag: ${id}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  async deleteTag(id: number): Promise<void> {
    const result = await this.pool.query(`DELETE FROM ${this.table('tags')} WHERE id = $1`, [id])
    if ((result.rowCount ?? 0) === 0) {
      throw new NotFoundError('Tag', id)
    }
  }

  async getTag(id: number): Promise<Tag | null> {
    const result = await this.pool.query<TagRow>(
      `SELECT id, name, color, created_at FROM ${this.table('tags')} WHERE id = $1`,
      [id]
    )

    const row = result.rows[0]
    return row === undefined ? null : toTag(row)
  }

  async getTagUsageCount(tagId: number): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `SELECT COUNT(*)::int AS count FROM ${this.table('variant_tags')} WHERE tag_id = $1`,
      [tagId]
    )

    return Number(result.rows[0]?.count ?? 0)
  }

  async getVariantTags(caseId: number, variantId: number): Promise<Tag[]> {
    const result = await this.pool.query<TagRow>(
      `
        SELECT t.id, t.name, t.color, t.created_at
        FROM ${this.table('tags')} AS t
        INNER JOIN ${this.table('variant_tags')} AS vt ON t.id = vt.tag_id
        WHERE vt.case_id = $1 AND vt.variant_id = $2
        ORDER BY t.name
      `,
      [caseId, variantId]
    )

    return result.rows.map(toTag)
  }

  async assignVariantTag(caseId: number, variantId: number, tagId: number): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.table('variant_tags')} (case_id, variant_id, tag_id, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (case_id, variant_id, tag_id) DO NOTHING
      `,
      [caseId, variantId, tagId, Date.now()]
    )
  }

  async removeVariantTag(caseId: number, variantId: number, tagId: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table(
        'variant_tags'
      )} WHERE case_id = $1 AND variant_id = $2 AND tag_id = $3`,
      [caseId, variantId, tagId]
    )
  }

  async setVariantTags(caseId: number, variantId: number, tagIds: number[]): Promise<void> {
    if (!this.pool.connect) {
      throw new DatabaseError('Postgres tags repository requires a transaction-capable pool')
    }
    await withTransaction(this.pool as TransactionCapablePool, async (client) => {
      await client.query(
        `DELETE FROM ${this.table('variant_tags')} WHERE case_id = $1 AND variant_id = $2`,
        [caseId, variantId]
      )

      const now = Date.now()
      for (const tagId of tagIds) {
        await client.query(
          `
            INSERT INTO ${this.table('variant_tags')} (case_id, variant_id, tag_id, created_at)
            VALUES ($1, $2, $3, $4)
          `,
          [caseId, variantId, tagId, now]
        )
      }
    })
  }

  private async getRequiredTag(id: number): Promise<Tag> {
    const tag = await this.getTag(id)
    if (!tag) throw new NotFoundError('Tag', id)
    return tag
  }

  private table(name: 'tags' | 'variant_tags'): string {
    return `${this.schemaName}.${quoteIdentifier(name)}`
  }
}

function toTag(row: TagRow): Tag {
  return {
    id: Number(row.id),
    name: String(row.name),
    color: String(row.color),
    created_at: Number(row.created_at)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
