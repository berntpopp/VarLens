import { BaseRepository } from './BaseRepository'
import type {
  FilterPreset,
  FilterPresetCreate,
  FilterPresetUpdate
} from '../../shared/types/filter-presets'
import { DatabaseError, NotFoundError, UniqueConstraintError } from './errors'

interface PresetRow {
  id: number
  name: string
  description: string | null
  filter_json: string
  is_built_in: number
  is_visible: number
  sort_order: number
  created_at: number
  updated_at: number
}

function rowToPreset(row: PresetRow): FilterPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    filterJson: JSON.parse(row.filter_json),
    isBuiltIn: row.is_built_in === 1,
    isVisible: row.is_visible === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class FilterPresetRepository extends BaseRepository {
  listPresets(): FilterPreset[] {
    const rows = this.execAll<PresetRow>(
      this.kysely.selectFrom('filter_presets').selectAll().orderBy('sort_order').orderBy('name')
    )
    return rows.map(rowToPreset)
  }

  getPreset(id: number): FilterPreset | null {
    const row = this.execFirst<PresetRow>(
      this.kysely.selectFrom('filter_presets').selectAll().where('id', '=', id)
    )
    return row ? rowToPreset(row) : null
  }

  createPreset(params: FilterPresetCreate): FilterPreset {
    try {
      const now = Date.now()
      const row = this.execFirst<PresetRow>(
        this.kysely
          .insertInto('filter_presets')
          .values({
            name: params.name,
            description: params.description ?? null,
            filter_json: JSON.stringify(params.filterJson),
            is_built_in: 0,
            is_visible: params.isVisible !== false ? 1 : 0,
            sort_order: params.sortOrder ?? 0,
            created_at: now,
            updated_at: now
          })
          .returningAll()
      )
      return rowToPreset(row as PresetRow)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new UniqueConstraintError('name', params.name)
      }
      throw new DatabaseError(
        `Failed to create preset: ${params.name}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  updatePreset(id: number, updates: FilterPresetUpdate): FilterPreset {
    try {
      const existing = this.execFirst<PresetRow>(
        this.kysely.selectFrom('filter_presets').selectAll().where('id', '=', id)
      )
      if (!existing) throw new NotFoundError('FilterPreset', id)

      const updateObj: Record<string, string | number | null> = {
        updated_at: Date.now()
      }

      // For built-in presets, only allow visibility and sort_order changes
      if (existing.is_built_in === 1) {
        if (updates.isVisible !== undefined) updateObj.is_visible = updates.isVisible ? 1 : 0
        if (updates.sortOrder !== undefined) updateObj.sort_order = updates.sortOrder
      } else {
        if (updates.name !== undefined) updateObj.name = updates.name
        if (updates.description !== undefined) updateObj.description = updates.description ?? null
        if (updates.filterJson !== undefined)
          updateObj.filter_json = JSON.stringify(updates.filterJson)
        if (updates.isVisible !== undefined) updateObj.is_visible = updates.isVisible ? 1 : 0
        if (updates.sortOrder !== undefined) updateObj.sort_order = updates.sortOrder
      }

      const row = this.execFirst<PresetRow>(
        this.kysely.updateTable('filter_presets').set(updateObj).where('id', '=', id).returningAll()
      )
      return rowToPreset(row as PresetRow)
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new UniqueConstraintError('name', updates.name ?? '')
      }
      throw new DatabaseError(
        `Failed to update preset: ${id}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  deletePreset(id: number): void {
    const existing = this.execFirst<PresetRow>(
      this.kysely.selectFrom('filter_presets').selectAll().where('id', '=', id)
    )
    if (!existing) throw new NotFoundError('FilterPreset', id)
    if (existing.is_built_in === 1) {
      throw new DatabaseError('Cannot delete built-in preset')
    }
    this.execRun(this.kysely.deleteFrom('filter_presets').where('id', '=', id))
  }

  reorderPresets(items: { id: number; sortOrder: number }[]): void {
    this.runTransaction(() => {
      const stmt = this.db.prepare(
        'UPDATE filter_presets SET sort_order = ?, updated_at = ? WHERE id = ?'
      )
      const now = Date.now()
      for (const item of items) {
        stmt.run(item.sortOrder, now, item.id)
      }
    })
  }
}
