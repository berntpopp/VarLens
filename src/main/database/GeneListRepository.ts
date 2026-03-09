import { BaseRepository } from './BaseRepository'
import type { GeneList, GeneListWithCount, RegionFile } from './types'

export class GeneListRepository extends BaseRepository {
  // ============================================================
  // Gene Lists
  // ============================================================

  listGeneLists(): GeneListWithCount[] {
    return this.stmt(
      `SELECT gl.*, COUNT(gli.id) AS gene_count
       FROM gene_lists gl
       LEFT JOIN gene_list_items gli ON gl.id = gli.gene_list_id
       GROUP BY gl.id
       ORDER BY gl.name`
    ).all() as GeneListWithCount[]
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
    return this.stmt(
      'INSERT INTO gene_lists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *'
    ).get(name, description ?? null, now, now) as GeneList
  }

  updateGeneList(id: number, updates: { name?: string; description?: string | null }): GeneList {
    const now = Date.now()
    const setClauses: string[] = ['updated_at = ?']
    const params: (string | number | null)[] = [now]

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      params.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      params.push(updates.description)
    }
    params.push(id)

    return this.stmt(`UPDATE gene_lists SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`).get(
      ...params
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
      this.stmt('DELETE FROM gene_list_items WHERE gene_list_id = ?').run(listId)
      const insert = this.stmt(
        'INSERT OR IGNORE INTO gene_list_items (gene_list_id, gene_symbol) VALUES (?, ?)'
      )
      for (const gene of genes) {
        const trimmed = gene.trim().toUpperCase()
        if (trimmed !== '') {
          insert.run(listId, trimmed)
        }
      }
      this.stmt('UPDATE gene_lists SET updated_at = ? WHERE id = ?').run(Date.now(), listId)
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
    return this.stmt(
      'INSERT INTO region_files (name, description, region_count, total_bases, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?) RETURNING *'
    ).get(name, description, now, now) as RegionFile
  }

  deleteRegionFile(id: number): void {
    this.execRun(this.kysely.deleteFrom('region_files').where('id', '=', id))
  }

  importBedEntries(
    fileId: number,
    entries: Array<{ chr: string; start: number; end: number; label?: string }>
  ): RegionFile {
    return this.runTransaction(() => {
      this.stmt('DELETE FROM region_file_entries WHERE region_file_id = ?').run(fileId)
      const insert = this.stmt(
        'INSERT INTO region_file_entries (region_file_id, chr, start_pos, end_pos, label) VALUES (?, ?, ?, ?, ?)'
      )
      let totalBases = 0
      for (const e of entries) {
        insert.run(fileId, e.chr, e.start, e.end, e.label ?? null)
        totalBases += e.end - e.start
      }
      this.stmt(
        'UPDATE region_files SET region_count = ?, total_bases = ?, updated_at = ? WHERE id = ?'
      ).run(entries.length, totalBases, Date.now(), fileId)

      return this.execFirst<RegionFile>(
        this.kysely.selectFrom('region_files').selectAll().where('id', '=', fileId)
      ) as RegionFile
    })
  }
}
