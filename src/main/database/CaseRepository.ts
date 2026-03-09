import { BaseRepository } from './BaseRepository'
import type { Case } from './types'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

export class CaseRepository extends BaseRepository {
  createCase(name: string, filePath: string, fileSize: number): number {
    try {
      const result = this.execRun(
        this.kysely.insertInto('cases').values({
          name,
          file_path: filePath,
          file_size: fileSize,
          variant_count: 0,
          created_at: Date.now()
        })
      )
      return Number(result.lastInsertRowid)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') === true) {
        throw new UniqueConstraintError('name', name)
      }
      throw new DatabaseError(
        `Failed to create case: ${name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  getCase(id: number): Case {
    const result = this.execFirst<Case>(
      this.kysely.selectFrom('cases').selectAll().where('id', '=', id)
    )
    if (!result) throw new NotFoundError('Case', id)
    return result
  }

  getCaseByName(name: string): Case {
    const result = this.execFirst<Case>(
      this.kysely.selectFrom('cases').selectAll().where('name', '=', name)
    )
    if (!result) throw new NotFoundError('Case', name)
    return result
  }

  getAllCases(): Case[] {
    return this.execAll<Case>(
      this.kysely.selectFrom('cases').selectAll().orderBy('created_at', 'desc')
    )
  }

  updateCaseVariantCount(id: number, count: number): void {
    const result = this.execRun(
      this.kysely.updateTable('cases').set({ variant_count: count }).where('id', '=', id)
    )
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteCase(id: number): void {
    const result = this.execRun(this.kysely.deleteFrom('cases').where('id', '=', id))
    if (result.changes === 0) throw new NotFoundError('Case', id)
  }

  deleteAllCases(): number {
    return this.execRun(this.kysely.deleteFrom('cases')).changes
  }

  deleteCasesBatch(ids: number[]): number {
    if (ids.length === 0) return 0
    return this.runTransaction(() => {
      const result = this.execRun(this.kysely.deleteFrom('cases').where('id', 'in', ids))
      return result.changes
    })
  }
}
