import { BaseRepository } from './BaseRepository'
import type { Tag } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

export class TagRepository extends BaseRepository {
  listTags(): Tag[] {
    return this.execAll<Tag>(this.kysely.selectFrom('tags').selectAll().orderBy('name'))
  }

  createTag(name: string, color: string): Tag {
    try {
      const now = Date.now()
      const result = this.stmt(
        'INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?) RETURNING *'
      ).get(name, color, now) as Tag
      return result
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create tag: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  updateTag(id: number, updates: { name?: string; color?: string }): Tag {
    try {
      const existing = this.execFirst<Tag>(
        this.kysely.selectFrom('tags').selectAll().where('id', '=', id)
      )
      if (!existing) throw new NotFoundError('Tag', id)

      const setClauses: string[] = []
      const params: (string | number)[] = []

      if (updates.name !== undefined) {
        setClauses.push('name = ?')
        params.push(updates.name)
      }
      if (updates.color !== undefined) {
        setClauses.push('color = ?')
        params.push(updates.color)
      }

      if (setClauses.length === 0) return existing

      params.push(id)
      const sql = `UPDATE tags SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`
      const result = this.db.prepare(sql).get(...params) as Tag
      return result
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', updates.name ?? '')
      }
      throw new DatabaseError(
        `Failed to update tag: ${id}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  deleteTag(id: number): void {
    const result = this.execRun(this.kysely.deleteFrom('tags').where('id', '=', id))
    if (result.changes === 0) throw new NotFoundError('Tag', id)
  }

  getTag(id: number): Tag | null {
    const result = this.execFirst<Tag>(
      this.kysely.selectFrom('tags').selectAll().where('id', '=', id)
    )
    return result ?? null
  }

  getTagUsageCount(tagId: number): number {
    const result = this.execFirst<{ count: number }>(
      this.kysely
        .selectFrom('variant_tags')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('tag_id', '=', tagId)
    )
    return result?.count ?? 0
  }

  getVariantTags(caseId: number, variantId: number): Tag[] {
    return this.stmt(
      `
      SELECT t.* FROM tags t
      JOIN variant_tags vt ON t.id = vt.tag_id
      WHERE vt.case_id = ? AND vt.variant_id = ?
      ORDER BY t.name
    `
    ).all(caseId, variantId) as Tag[]
  }

  assignVariantTag(caseId: number, variantId: number, tagId: number): void {
    const now = Date.now()
    this.stmt(
      'INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
    ).run(caseId, variantId, tagId, now)
  }

  removeVariantTag(caseId: number, variantId: number, tagId: number): void {
    this.execRun(
      this.kysely
        .deleteFrom('variant_tags')
        .where('case_id', '=', caseId)
        .where('variant_id', '=', variantId)
        .where('tag_id', '=', tagId)
    )
  }

  setVariantTags(caseId: number, variantId: number, tagIds: number[]): void {
    this.runTransaction(() => {
      this.stmt('DELETE FROM variant_tags WHERE case_id = ? AND variant_id = ?').run(
        caseId,
        variantId
      )
      const now = Date.now()
      const insert = this.stmt(
        'INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at) VALUES (?, ?, ?, ?)'
      )
      for (const tagId of tagIds) {
        insert.run(caseId, variantId, tagId, now)
      }
    })
  }
}
