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
      return this.execFirst<Tag>(
        this.kysely.insertInto('tags').values({ name, color, created_at: now }).returningAll()
      ) as Tag
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

      const updateObj: Record<string, string | number> = {}
      if (updates.name !== undefined) updateObj.name = updates.name
      if (updates.color !== undefined) updateObj.color = updates.color

      if (Object.keys(updateObj).length === 0) return existing

      return this.execFirst<Tag>(
        this.kysely.updateTable('tags').set(updateObj).where('id', '=', id).returningAll()
      ) as Tag
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
    return this.execAll<Tag>(
      this.kysely
        .selectFrom('tags as t')
        .innerJoin('variant_tags as vt', 't.id', 'vt.tag_id')
        .selectAll('t')
        .where('vt.case_id', '=', caseId)
        .where('vt.variant_id', '=', variantId)
        .orderBy('t.name')
    )
  }

  assignVariantTag(caseId: number, variantId: number, tagId: number): void {
    const now = Date.now()
    this.execRun(
      this.kysely
        .insertInto('variant_tags')
        .values({ case_id: caseId, variant_id: variantId, tag_id: tagId, created_at: now })
        .onConflict((oc) => oc.doNothing())
    )
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
      this.execRun(
        this.kysely
          .deleteFrom('variant_tags')
          .where('case_id', '=', caseId)
          .where('variant_id', '=', variantId)
      )
      const now = Date.now()
      // Prepare statement once outside the loop to avoid repeated compilation
      const insertStmt = this.db.prepare(
        'INSERT INTO variant_tags (case_id, variant_id, tag_id, created_at) VALUES (?, ?, ?, ?)'
      )
      for (const tagId of tagIds) {
        insertStmt.run(caseId, variantId, tagId, now)
      }
    })
  }
}
