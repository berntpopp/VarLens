import { BaseRepository } from './BaseRepository'
import type { GeneReferenceDb } from './GeneReferenceDb'
import { sqlPlaceholders } from './sql-utils'

// ── Types ────────────────────────────────────────────────────

import type {
  GenomicInterval,
  CreatePanelInput,
  PanelRow,
  PanelWithCount,
  PanelGeneRow,
  ActivePanelRow
} from '../../shared/types/panels'
export type {
  GenomicInterval,
  CreatePanelInput,
  PanelRow,
  PanelWithCount,
  PanelGeneRow,
  ActivePanelRow
}

// ── Repository ───────────────────────────────────────────────

export class PanelRepository extends BaseRepository {
  createPanel(input: CreatePanelInput): PanelRow {
    const now = Date.now()
    return this.execFirst<PanelRow>(
      this.kysely
        .insertInto('panels')
        .values({
          name: input.name,
          description: input.description ?? null,
          version: input.version ?? null,
          source: input.source,
          source_id: input.sourceId ?? null,
          source_metadata: input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : null,
          created_at: now,
          updated_at: now
        })
        .returningAll()
    ) as PanelRow
  }

  listPanels(): PanelWithCount[] {
    return this.execAll<PanelWithCount>(
      this.kysely
        .selectFrom('panels as p')
        .leftJoin('panel_genes as pg', 'p.id', 'pg.panel_id')
        .selectAll('p')
        .select(({ fn }) => fn.count<number>('pg.id').as('gene_count'))
        .groupBy('p.id')
        .orderBy('p.name')
    )
  }

  getPanel(id: number): PanelRow | null {
    return (
      this.execFirst<PanelRow>(this.kysely.selectFrom('panels').selectAll().where('id', '=', id)) ??
      null
    )
  }

  updatePanel(
    id: number,
    updates: { name?: string; description?: string | null; version?: string | null }
  ): PanelRow | null {
    const now = Date.now()
    const updateObj: Record<string, string | number | null> = { updated_at: now }
    if (updates.name !== undefined) updateObj.name = updates.name
    if (updates.description !== undefined) updateObj.description = updates.description
    if (updates.version !== undefined) updateObj.version = updates.version

    const updated = this.execFirst<PanelRow>(
      this.kysely.updateTable('panels').set(updateObj).where('id', '=', id).returningAll()
    )
    return updated ?? null
  }

  deletePanel(id: number): void {
    this.execRun(this.kysely.deleteFrom('panels').where('id', '=', id))
  }

  setGenes(panelId: number, genes: Array<{ hgncId: string; symbol: string }>): void {
    this.runTransaction(() => {
      this.execRun(this.kysely.deleteFrom('panel_genes').where('panel_id', '=', panelId))
      const insertStmt = this.db.prepare(
        'INSERT OR IGNORE INTO panel_genes (panel_id, hgnc_id, symbol) VALUES (?, ?, ?)'
      )
      for (const gene of genes) {
        insertStmt.run(panelId, gene.hgncId, gene.symbol)
      }
      this.execRun(
        this.kysely.updateTable('panels').set({ updated_at: Date.now() }).where('id', '=', panelId)
      )
    })
  }

  getGenes(panelId: number): PanelGeneRow[] {
    return this.execAll<PanelGeneRow>(
      this.kysely
        .selectFrom('panel_genes')
        .selectAll()
        .where('panel_id', '=', panelId)
        .orderBy('symbol')
    )
  }

  duplicatePanel(id: number, newName: string): PanelRow {
    return this.runTransaction(() => {
      const original = this.getPanel(id)
      if (!original) throw new Error(`Panel ${id} not found`)

      const copy = this.createPanel({
        name: newName,
        description: original.description,
        version: original.version,
        source: original.source,
        sourceId: original.source_id,
        sourceMetadata:
          original.source_metadata != null ? JSON.parse(original.source_metadata) : null
      })

      const genes = this.getGenes(id)
      if (genes.length > 0) {
        const insertStmt = this.db.prepare(
          'INSERT OR IGNORE INTO panel_genes (panel_id, hgnc_id, symbol) VALUES (?, ?, ?)'
        )
        for (const gene of genes) {
          insertStmt.run(copy.id, gene.hgnc_id, gene.symbol)
        }
      }

      return copy
    })
  }

  activatePanel(caseId: number, panelId: number, paddingBp: number = 5000): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO case_active_panels (case_id, panel_id, padding_bp, activated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(caseId, panelId, paddingBp, now)
  }

  deactivatePanel(caseId: number, panelId: number): void {
    this.execRun(
      this.kysely
        .deleteFrom('case_active_panels')
        .where('case_id', '=', caseId)
        .where('panel_id', '=', panelId)
    )
  }

  getActivePanelsForCase(caseId: number): ActivePanelRow[] {
    const rows = this.db
      .prepare(
        `SELECT cap.case_id, cap.panel_id, cap.padding_bp, cap.activated_at,
                p.name AS panel_name,
                COUNT(pg.id) AS gene_count
         FROM case_active_panels cap
         JOIN panels p ON cap.panel_id = p.id
         LEFT JOIN panel_genes pg ON p.id = pg.panel_id
         WHERE cap.case_id = ?
         GROUP BY cap.panel_id
         ORDER BY p.name`
      )
      .all(caseId) as ActivePanelRow[]
    return rows
  }

  /**
   * Compute merged genomic intervals for gene panel filtering.
   *
   * 1. Collects distinct HGNC IDs from the given panel IDs
   * 2. Looks up coordinates from the gene reference database
   * 3. Applies padding, optional chr prefix, sorts and merges overlapping intervals
   */
  computeIntervals(
    panelIds: number[],
    assembly: string,
    paddingBp: number,
    geneRefDb: GeneReferenceDb,
    chrPrefix: boolean = false
  ): GenomicInterval[] {
    if (panelIds.length === 0) return []

    // Get all distinct hgnc_ids from panel_genes for the given panel IDs
    const placeholders = sqlPlaceholders(panelIds.length)
    const rows = this.db
      .prepare(`SELECT DISTINCT hgnc_id FROM panel_genes WHERE panel_id IN (${placeholders})`)
      .all(...panelIds) as Array<{ hgnc_id: string }>

    const hgncIds = rows.map((r) => r.hgnc_id)
    if (hgncIds.length === 0) return []

    // Look up coordinates from gene reference DB
    const coordsMap = geneRefDb.getCoordinatesForGenes(hgncIds, assembly)

    // Build intervals with padding and optional chr prefix
    const intervals: GenomicInterval[] = []
    for (const coords of coordsMap.values()) {
      const chr = chrPrefix
        ? coords.chromosome.startsWith('chr')
          ? coords.chromosome
          : `chr${coords.chromosome}`
        : coords.chromosome
      intervals.push({
        chr,
        start: Math.max(1, coords.start_pos - paddingBp),
        end: coords.end_pos + paddingBp
      })
    }

    return mergeOverlappingIntervals(intervals)
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Sort intervals by chromosome (natural sort) then start position,
 * and merge overlapping or adjacent intervals on the same chromosome.
 */
export function mergeOverlappingIntervals(intervals: GenomicInterval[]): GenomicInterval[] {
  if (intervals.length === 0) return []

  const sorted = [...intervals].sort((a, b) => {
    if (a.chr !== b.chr) return a.chr.localeCompare(b.chr, undefined, { numeric: true })
    return a.start - b.start
  })

  const merged: GenomicInterval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.chr === last.chr && curr.start <= last.end + 1) {
      last.end = Math.max(last.end, curr.end)
    } else {
      merged.push({ ...curr })
    }
  }
  return merged
}
