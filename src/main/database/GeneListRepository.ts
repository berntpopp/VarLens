import { BaseRepository } from './BaseRepository'
import type { GeneList, GeneListWithCount, RegionFile } from './types'

export class GeneListRepository extends BaseRepository {
  // ============================================================
  // Gene Lists
  // ============================================================

  listGeneLists(): GeneListWithCount[] {
    return this.execAll<GeneListWithCount>(
      this.kysely
        .selectFrom('gene_lists as gl')
        .leftJoin('gene_list_items as gli', 'gl.id', 'gli.gene_list_id')
        .selectAll('gl')
        .select(({ fn }) => fn.count<number>('gli.id').as('gene_count'))
        .groupBy('gl.id')
        .orderBy('gl.name')
    )
  }

  getGeneList(id: number): GeneList | null {
    return (
      this.execFirst<GeneList>(
        this.kysely.selectFrom('gene_lists').selectAll().where('id', '=', id)
      ) ?? null
    )
  }

  createGeneList(name: string, description?: string | null): GeneList {
    const now = Date.now()
    return this.execFirst<GeneList>(
      this.kysely
        .insertInto('gene_lists')
        .values({ name, description: description ?? null, created_at: now, updated_at: now })
        .returningAll()
    ) as GeneList
  }

  updateGeneList(id: number, updates: { name?: string; description?: string | null }): GeneList {
    const now = Date.now()
    const updateObj: Record<string, string | number | null> = { updated_at: now }
    if (updates.name !== undefined) updateObj.name = updates.name
    if (updates.description !== undefined) updateObj.description = updates.description

    return this.execFirst<GeneList>(
      this.kysely.updateTable('gene_lists').set(updateObj).where('id', '=', id).returningAll()
    ) as GeneList
  }

  deleteGeneList(id: number): void {
    this.execRun(this.kysely.deleteFrom('gene_lists').where('id', '=', id))
  }

  getGeneListGenes(listId: number): string[] {
    const rows = this.execAll<{ gene_symbol: string }>(
      this.kysely
        .selectFrom('gene_list_items')
        .select('gene_symbol')
        .where('gene_list_id', '=', listId)
        .orderBy('gene_symbol')
    )
    return rows.map((r) => r.gene_symbol)
  }

  setGeneListGenes(listId: number, genes: string[]): void {
    this.runTransaction(() => {
      this.execRun(this.kysely.deleteFrom('gene_list_items').where('gene_list_id', '=', listId))
      // Prepare statement once outside the loop for O(1) compilation overhead
      const insertStmt = this.db.prepare(
        'INSERT OR IGNORE INTO gene_list_items (gene_list_id, gene_symbol) VALUES (?, ?)'
      )
      for (const gene of genes) {
        const trimmed = gene.trim().toUpperCase()
        if (trimmed !== '') {
          insertStmt.run(listId, trimmed)
        }
      }
      this.execRun(
        this.kysely
          .updateTable('gene_lists')
          .set({ updated_at: Date.now() })
          .where('id', '=', listId)
      )
    })
  }

  // ============================================================
  // Region Files (BED)
  // ============================================================

  listRegionFiles(): RegionFile[] {
    return this.execAll<RegionFile>(
      this.kysely.selectFrom('region_files').selectAll().orderBy('name')
    )
  }

  createRegionFile(name: string, description: string | null): RegionFile {
    const now = Date.now()
    return this.execFirst<RegionFile>(
      this.kysely
        .insertInto('region_files')
        .values({
          name,
          description,
          region_count: 0,
          total_bases: 0,
          created_at: now,
          updated_at: now
        })
        .returningAll()
    ) as RegionFile
  }

  deleteRegionFile(id: number): void {
    this.execRun(this.kysely.deleteFrom('region_files').where('id', '=', id))
  }

  importBedEntries(
    fileId: number,
    entries: Array<{ chr: string; start: number; end: number; label?: string }>
  ): RegionFile {
    return this.runTransaction(() => {
      this.execRun(
        this.kysely.deleteFrom('region_file_entries').where('region_file_id', '=', fileId)
      )
      let totalBases = 0
      for (const e of entries) {
        this.execRun(
          this.kysely.insertInto('region_file_entries').values({
            region_file_id: fileId,
            chr: e.chr,
            start_pos: e.start,
            end_pos: e.end,
            label: e.label ?? null
          })
        )
        totalBases += e.end - e.start
      }
      this.execRun(
        this.kysely
          .updateTable('region_files')
          .set({ region_count: entries.length, total_bases: totalBases, updated_at: Date.now() })
          .where('id', '=', fileId)
      )

      return this.execFirst<RegionFile>(
        this.kysely.selectFrom('region_files').selectAll().where('id', '=', fileId)
      ) as RegionFile
    })
  }
}
