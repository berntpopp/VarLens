import type { Pool, PoolClient, QueryResult } from 'pg'

import type { GeneList, GeneListWithCount, RegionFile } from '../../../shared/types/database'
import type {
  ActivePanelRow,
  CreatePanelInput,
  PanelGeneRow,
  PanelRow,
  PanelWithCount
} from '../../../shared/types/panels'
import { quoteIdentifier } from './identifiers'
import { MAX_BED_FILTER_DECOMPRESSED_BYTES } from '../../import/vcf/bed-filter'
import { readBedEntries, type BedEntry, type BedReaderOptions } from '../../import/vcf/bed-reader'
import { resolveMaxDecompressedBytes } from '../../import/stream-utils'

type Queryable = Pick<Pool, 'query' | 'connect'>
type Row = Record<string, unknown>

export const REGION_FILE_INSERT_CHUNK_SIZE = 10_000

const integerFields = new Set([
  'id',
  'panel_id',
  'case_id',
  'padding_bp',
  'activated_at',
  'gene_count',
  'region_count',
  'total_bases',
  'start_pos',
  'end_pos',
  'created_at',
  'updated_at'
])

function normalizeRow<T extends Row>(row: T): Row {
  const normalized: Row = { ...row }
  for (const field of integerFields) {
    const value = normalized[field]
    if (typeof value === 'string') {
      normalized[field] = Number(value)
    }
  }
  return normalized
}

function firstNormalized<T>(result: QueryResult<Row>): T | null {
  const row = result.rows[0]
  return row === undefined ? null : (normalizeRow(row) as T)
}

function allNormalized<T>(result: QueryResult<Row>): T[] {
  return result.rows.map((row) => normalizeRow(row) as T)
}

export class PostgresPanelsRepository {
  constructor(
    private readonly pool: Queryable,
    private readonly schema: string
  ) {}

  async createPanel(input: CreatePanelInput): Promise<PanelRow> {
    return this.insertPanel(this.pool, input.name, {
      description: input.description ?? null,
      version: input.version ?? null,
      source: input.source,
      sourceId: input.sourceId ?? null,
      sourceMetadata: input.sourceMetadata ?? null
    })
  }

  async listPanels(): Promise<PanelWithCount[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT p.*, COUNT(pg.id)::int AS gene_count
        FROM ${this.table('panels')} p
        LEFT JOIN ${this.table('panel_genes')} pg ON p.id = pg.panel_id
        GROUP BY p.id
        ORDER BY p.name
      `,
      []
    )
    return allNormalized<PanelWithCount>(result)
  }

  async getPanel(id: number): Promise<PanelRow | null> {
    return this.getPanelWith(this.pool, id)
  }

  async updatePanel(
    id: number,
    updates: { name?: string; description?: string | null; version?: string | null }
  ): Promise<PanelRow | null> {
    const assignments = ['updated_at = $1']
    const values: unknown[] = [Date.now(), id]
    let nextParam = 3

    if (updates.name !== undefined) {
      assignments.push(`name = $${nextParam}`)
      nextParam += 1
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      assignments.push(`description = $${nextParam}`)
      nextParam += 1
      values.push(updates.description)
    }
    if (updates.version !== undefined) {
      assignments.push(`version = $${nextParam}`)
      values.push(updates.version)
    }

    const result = await this.pool.query<Row>(
      `
        UPDATE ${this.table('panels')}
        SET ${assignments.join(', ')}
        WHERE id = $2
        RETURNING *
      `,
      values
    )
    return firstNormalized<PanelRow>(result)
  }

  async deletePanel(id: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table('panels')} WHERE id = $1`, [id])
  }

  async setGenes(panelId: number, genes: Array<{ hgncId: string; symbol: string }>): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(`DELETE FROM ${this.table('panel_genes')} WHERE panel_id = $1`, [panelId])
      if (genes.length > 0) {
        await this.insertPanelGenes(client, panelId, genes)
      }
      await client.query(`UPDATE ${this.table('panels')} SET updated_at = $1 WHERE id = $2`, [
        Date.now(),
        panelId
      ])
    })
  }

  async getGenes(panelId: number): Promise<PanelGeneRow[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('panel_genes')} WHERE panel_id = $1 ORDER BY symbol`,
      [panelId]
    )
    return allNormalized<PanelGeneRow>(result)
  }

  async duplicatePanel(id: number, newName: string): Promise<PanelRow> {
    return this.withTransaction(async (client) => {
      const original = await this.getPanelWith(client, id)
      if (original === null) {
        throw new Error(`Panel ${id} not found`)
      }

      const copy = await this.insertPanel(client, newName, {
        description: original.description,
        version: original.version,
        source: original.source,
        sourceId: original.source_id,
        sourceMetadata:
          original.source_metadata !== null ? JSON.parse(original.source_metadata) : null
      })

      const genesResult = await client.query<Row>(
        `SELECT * FROM ${this.table('panel_genes')} WHERE panel_id = $1 ORDER BY symbol`,
        [id]
      )
      const genes = allNormalized<PanelGeneRow>(genesResult)
      if (genes.length > 0) {
        await this.insertPanelGenes(
          client,
          copy.id,
          genes.map((gene) => ({ hgncId: gene.hgnc_id, symbol: gene.symbol }))
        )
      }

      return copy
    })
  }

  async activatePanel(caseId: number, panelId: number, paddingBp: number = 5000): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ${this.table('case_active_panels')} (
          case_id,
          panel_id,
          padding_bp,
          activated_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (case_id, panel_id) DO UPDATE SET
          padding_bp = EXCLUDED.padding_bp,
          activated_at = EXCLUDED.activated_at
      `,
      [caseId, panelId, paddingBp, Date.now()]
    )
  }

  async deactivatePanel(caseId: number, panelId: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table('case_active_panels')} WHERE case_id = $1 AND panel_id = $2`,
      [caseId, panelId]
    )
  }

  async getActivePanelsForCase(caseId: number): Promise<ActivePanelRow[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT
          cap.case_id,
          cap.panel_id,
          cap.padding_bp,
          cap.activated_at,
          p.name AS panel_name,
          COUNT(pg.id)::int AS gene_count
        FROM ${this.table('case_active_panels')} cap
        JOIN ${this.table('panels')} p ON cap.panel_id = p.id
        LEFT JOIN ${this.table('panel_genes')} pg ON p.id = pg.panel_id
        WHERE cap.case_id = $1
        GROUP BY cap.case_id, cap.panel_id, cap.padding_bp, cap.activated_at, p.name
        ORDER BY p.name
      `,
      [caseId]
    )
    return allNormalized<ActivePanelRow>(result)
  }

  async listGeneLists(): Promise<GeneListWithCount[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT gl.*, COUNT(gli.id)::int AS gene_count
        FROM ${this.table('gene_lists')} gl
        LEFT JOIN ${this.table('gene_list_items')} gli ON gl.id = gli.gene_list_id
        GROUP BY gl.id
        ORDER BY gl.name
      `,
      []
    )
    return allNormalized<GeneListWithCount>(result)
  }

  async getGeneList(id: number): Promise<GeneList | null> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('gene_lists')} WHERE id = $1`,
      [id]
    )
    return firstNormalized<GeneList>(result)
  }

  async createGeneList(name: string, description?: string | null): Promise<GeneList> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('gene_lists')} (name, description, created_at, updated_at)
        VALUES ($1, $2, $3, $3)
        RETURNING *
      `,
      [name, description ?? null, Date.now()]
    )
    return firstNormalized<GeneList>(result) as GeneList
  }

  async updateGeneList(
    id: number,
    updates: { name?: string; description?: string | null }
  ): Promise<GeneList | null> {
    const assignments = ['updated_at = $1']
    const values: unknown[] = [Date.now(), id]
    let nextParam = 3

    if (updates.name !== undefined) {
      assignments.push(`name = $${nextParam}`)
      nextParam += 1
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      assignments.push(`description = $${nextParam}`)
      values.push(updates.description)
    }

    const result = await this.pool.query<Row>(
      `
        UPDATE ${this.table('gene_lists')}
        SET ${assignments.join(', ')}
        WHERE id = $2
        RETURNING *
      `,
      values
    )
    return firstNormalized<GeneList>(result)
  }

  async deleteGeneList(id: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table('gene_lists')} WHERE id = $1`, [id])
  }

  async getGeneListGenes(listId: number): Promise<string[]> {
    const result = await this.pool.query<{ gene_symbol: string }>(
      `SELECT gene_symbol FROM ${this.table('gene_list_items')} WHERE gene_list_id = $1 ORDER BY gene_symbol`,
      [listId]
    )
    return result.rows.map((row) => row.gene_symbol)
  }

  async setGeneListGenes(listId: number, genes: string[]): Promise<void> {
    const normalizedGenes = genes.map((gene) => gene.trim().toUpperCase()).filter(Boolean)

    await this.withTransaction(async (client) => {
      await client.query(`DELETE FROM ${this.table('gene_list_items')} WHERE gene_list_id = $1`, [
        listId
      ])
      if (normalizedGenes.length > 0) {
        await client.query(
          `
            INSERT INTO ${this.table('gene_list_items')} (gene_list_id, gene_symbol)
            SELECT $1, gene_symbol
            FROM UNNEST($2::text[]) AS gene_symbol
            ON CONFLICT (gene_list_id, gene_symbol) DO NOTHING
          `,
          [listId, normalizedGenes]
        )
      }
      await client.query(`UPDATE ${this.table('gene_lists')} SET updated_at = $1 WHERE id = $2`, [
        Date.now(),
        listId
      ])
    })
  }

  async listRegionFiles(): Promise<RegionFile[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM ${this.table('region_files')} ORDER BY name`,
      []
    )
    return allNormalized<RegionFile>(result)
  }

  async createRegionFile(name: string, description: string | null): Promise<RegionFile> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('region_files')} (
          name,
          description,
          region_count,
          total_bases,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 0, 0, $3, $3)
        RETURNING *
      `,
      [name, description, Date.now()]
    )
    return firstNormalized<RegionFile>(result) as RegionFile
  }

  async deleteRegionFile(id: number): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table('region_files')} WHERE id = $1`, [id])
  }

  async importBedFile(
    fileId: number,
    filePath: string,
    options: BedReaderOptions = {}
  ): Promise<RegionFile> {
    return this.withTransaction(async (client) => {
      const locked = await client.query<Row>(
        `SELECT id FROM ${this.table('region_files')} WHERE id = $1 FOR UPDATE`,
        [fileId]
      )
      if (locked.rows.length === 0) throw new Error(`Region file ${fileId} not found`)

      await client.query(
        `DELETE FROM ${this.table('region_file_entries')} WHERE region_file_id = $1`,
        [fileId]
      )

      const maxBytes = Math.min(resolveMaxDecompressedBytes(), MAX_BED_FILTER_DECOMPRESSED_BYTES)
      let chunk: BedEntry[] = []
      let regionCount = 0
      let totalBases = 0
      for await (const entry of readBedEntries(filePath, maxBytes, options)) {
        chunk.push(entry)
        regionCount += 1
        totalBases = addSafeBaseCount(totalBases, entry.end - entry.start)
        if (chunk.length >= REGION_FILE_INSERT_CHUNK_SIZE) {
          await this.insertRegionChunk(client, fileId, chunk)
          chunk = []
        }
      }
      if (chunk.length > 0) await this.insertRegionChunk(client, fileId, chunk)

      await client.query(
        `
          UPDATE ${this.table('region_files')}
          SET region_count = $1, total_bases = $2, updated_at = $3
          WHERE id = $4
        `,
        [regionCount, totalBases, Date.now(), fileId]
      )

      const result = await client.query<Row>(
        `SELECT * FROM ${this.table('region_files')} WHERE id = $1`,
        [fileId]
      )
      return firstNormalized<RegionFile>(result) as RegionFile
    })
  }

  private async insertRegionChunk(
    client: Pick<PoolClient, 'query'>,
    fileId: number,
    chunk: BedEntry[]
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.table('region_file_entries')} (
          region_file_id,
          chr,
          start_pos,
          end_pos,
          label
        )
        SELECT $1, chr, start_pos, end_pos, label
        FROM UNNEST($2::text[], $3::bigint[], $4::bigint[], $5::text[])
          AS entry(chr, start_pos, end_pos, label)
      `,
      [
        fileId,
        chunk.map((entry) => entry.chr),
        chunk.map((entry) => entry.start),
        chunk.map((entry) => entry.end),
        chunk.map((entry) => entry.label ?? null)
      ]
    )
  }

  private async insertPanel(
    target: Pick<Pool | PoolClient, 'query'>,
    name: string,
    fields: {
      description: string | null
      version: string | null
      source: string
      sourceId: string | null
      sourceMetadata: Record<string, unknown> | null
    }
  ): Promise<PanelRow> {
    const result = await target.query<Row>(
      `
        INSERT INTO ${this.table('panels')} (
          name,
          description,
          version,
          source,
          source_id,
          source_metadata,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING *
      `,
      [
        name,
        fields.description,
        fields.version,
        fields.source,
        fields.sourceId,
        fields.sourceMetadata === null ? null : JSON.stringify(fields.sourceMetadata),
        Date.now()
      ]
    )
    return firstNormalized<PanelRow>(result) as PanelRow
  }

  private async getPanelWith(
    target: Pick<Pool | PoolClient, 'query'>,
    id: number
  ): Promise<PanelRow | null> {
    const result = await target.query<Row>(`SELECT * FROM ${this.table('panels')} WHERE id = $1`, [
      id
    ])
    return firstNormalized<PanelRow>(result)
  }

  private async insertPanelGenes(
    target: Pick<Pool | PoolClient, 'query'>,
    panelId: number,
    genes: Array<{ hgncId: string; symbol: string }>
  ): Promise<void> {
    await target.query(
      `
        INSERT INTO ${this.table('panel_genes')} (panel_id, hgnc_id, symbol)
        SELECT $1, hgnc_id, symbol
        FROM UNNEST($2::text[], $3::text[]) AS gene(hgnc_id, symbol)
        ON CONFLICT (panel_id, hgnc_id) DO NOTHING
      `,
      [panelId, genes.map((gene) => gene.hgncId), genes.map((gene) => gene.symbol)]
    )
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`
  }
}

function addSafeBaseCount(total: number, increment: number): number {
  const next = total + increment
  if (!Number.isSafeInteger(next)) {
    throw new RangeError('BED total base count exceeds the safe integer range')
  }
  return next
}
