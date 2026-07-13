import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PostgresPanelsRepository,
  REGION_FILE_INSERT_CHUNK_SIZE
} from '../../../src/main/storage/postgres/PostgresPanelsRepository'

const now = new Date('2026-04-29T00:00:00.000Z').getTime()

function makePool() {
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes('FOR UPDATE') ? [{ id: '1' }] : []
    })),
    release: vi.fn()
  }
  const pool = {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => client)
  }

  return { client, pool }
}

describe('PostgresPanelsRepository', () => {
  let tempDir: string

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    tempDir = mkdtempSync(join(tmpdir(), 'varlens-pg-bed-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('creates panels with metadata and normalizes returned numeric fields', async () => {
    const { pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '7',
          name: 'PanelApp Panel',
          description: 'A test panel',
          version: '4.2',
          source: 'panelapp_uk',
          source_id: '396',
          source_metadata: '{"confidence":"green"}',
          created_at: String(now),
          updated_at: String(now)
        }
      ]
    })
    const repo = new PostgresPanelsRepository(pool as never, 'tenant"schema')

    await expect(
      repo.createPanel({
        name: 'PanelApp Panel',
        source: 'panelapp_uk',
        description: 'A test panel',
        version: '4.2',
        sourceId: '396',
        sourceMetadata: { confidence: 'green' }
      })
    ).resolves.toMatchObject({ id: 7, created_at: now, updated_at: now })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "tenant""schema"."panels"'),
      ['PanelApp Panel', 'A test panel', '4.2', 'panelapp_uk', '396', '{"confidence":"green"}', now]
    )
  })

  it('lists panels with gene counts ordered by name', async () => {
    const { pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [{ id: '1', name: 'Alpha', gene_count: '2', created_at: String(now) }]
    })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.listPanels()).resolves.toStrictEqual([
      { id: 1, name: 'Alpha', gene_count: 2, created_at: now }
    ])

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN "public"."panel_genes" pg ON p.id = pg.panel_id'),
      []
    )
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY p.name'), [])
  })

  it('updates only supplied panel fields and returns null for missing rows', async () => {
    const { pool } = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'New', version: '2.0' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.updatePanel(1, { name: 'New', version: '2.0' })).resolves.toMatchObject({
      id: 1,
      name: 'New',
      version: '2.0'
    })
    await expect(repo.updatePanel(99, { description: null })).resolves.toBeNull()

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE "public"."panels"'),
      [now, 1, 'New', '2.0']
    )
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('description = $3'), [
      now,
      99,
      null
    ])
  })

  it('replaces panel genes transactionally and fetches them ordered by symbol', async () => {
    const { client, pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: '2', panel_id: '1', hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
        { id: '3', panel_id: '1', hgnc_id: 'HGNC:1101', symbol: 'BRCA2' }
      ]
    })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await repo.setGenes(1, [
      { hgncId: 'HGNC:1100', symbol: 'BRCA1' },
      { hgncId: 'HGNC:1101', symbol: 'BRCA2' }
    ])
    await expect(repo.getGenes(1)).resolves.toStrictEqual([
      { id: 2, panel_id: 1, hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
      { id: 3, panel_id: 1, hgnc_id: 'HGNC:1101', symbol: 'BRCA2' }
    ])

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM "public"."panel_genes" WHERE panel_id = $1',
      [1]
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UNNEST($2::text[], $3::text[])'),
      [1, ['HGNC:1100', 'HGNC:1101'], ['BRCA1', 'BRCA2']]
    )
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE "public"."panels" SET updated_at = $1 WHERE id = $2',
      [now, 1]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT * FROM "public"."panel_genes" WHERE panel_id = $1 ORDER BY symbol',
      [1]
    )
  })

  it('duplicates a panel with genes in one transaction', async () => {
    const { client, pool } = makePool()
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            name: 'Original',
            description: 'Desc',
            version: '1.0',
            source: 'panelapp_uk',
            source_id: '396',
            source_metadata: '{"confidence":"green"}'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ id: '2', name: 'Copy' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: '10', panel_id: '1', hgnc_id: 'HGNC:1100', symbol: 'BRCA1' },
          { id: '11', panel_id: '1', hgnc_id: 'HGNC:1101', symbol: 'BRCA2' }
        ]
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.duplicatePanel(1, 'Copy')).resolves.toMatchObject({ id: 2, name: 'Copy' })

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith('SELECT * FROM "public"."panels" WHERE id = $1', [1])
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "public"."panels"'),
      ['Copy', 'Desc', '1.0', 'panelapp_uk', '396', '{"confidence":"green"}', now]
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UNNEST($2::text[], $3::text[])'),
      [2, ['HGNC:1100', 'HGNC:1101'], ['BRCA1', 'BRCA2']]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('activates, replaces, deactivates, and lists active panels for a case', async () => {
    const { pool } = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            case_id: '5',
            panel_id: '2',
            padding_bp: '3000',
            activated_at: String(now),
            panel_name: 'Active Panel',
            gene_count: '1'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await repo.activatePanel(5, 2, 3000)
    await expect(repo.getActivePanelsForCase(5)).resolves.toStrictEqual([
      {
        case_id: 5,
        panel_id: 2,
        padding_bp: 3000,
        activated_at: now,
        panel_name: 'Active Panel',
        gene_count: 1
      }
    ])
    await repo.deactivatePanel(5, 2)

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ON CONFLICT (case_id, panel_id) DO UPDATE SET'),
      [5, 2, 3000, now]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('JOIN "public"."panels" p ON cap.panel_id = p.id'),
      [5]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM "public"."case_active_panels" WHERE case_id = $1 AND panel_id = $2',
      [5, 2]
    )
  })

  it('creates, updates, deletes, and replaces genes in gene lists', async () => {
    const { client, pool } = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Curated', gene_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Updated', description: null }] })
      .mockResolvedValueOnce({ rows: [{ gene_symbol: 'BRCA1' }, { gene_symbol: 'TP53' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.createGeneList('Curated', 'Desc')).resolves.toMatchObject({
      id: 1,
      name: 'Curated',
      gene_count: 2
    })
    await expect(
      repo.updateGeneList(1, { name: 'Updated', description: null })
    ).resolves.toMatchObject({
      id: 1,
      name: 'Updated',
      description: null
    })
    await repo.setGeneListGenes(1, [' brca1 ', '', 'tp53'])
    await expect(repo.getGeneListGenes(1)).resolves.toStrictEqual(['BRCA1', 'TP53'])
    await repo.deleteGeneList(1)

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO "public"."gene_lists"'),
      ['Curated', 'Desc', now]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE "public"."gene_lists"'),
      [now, 1, 'Updated', null]
    )
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM "public"."gene_list_items" WHERE gene_list_id = $1',
      [1]
    )
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UNNEST($2::text[])'), [
      1,
      ['BRCA1', 'TP53']
    ])
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      'DELETE FROM "public"."gene_lists" WHERE id = $1',
      [1]
    )
  })

  it('lists gene lists with counts and gets a single gene list', async () => {
    const { pool } = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Alpha', gene_count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: '1', name: 'Alpha', created_at: String(now) }] })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.listGeneLists()).resolves.toStrictEqual([
      { id: 1, name: 'Alpha', gene_count: 1 }
    ])
    await expect(repo.getGeneList(1)).resolves.toStrictEqual({
      id: 1,
      name: 'Alpha',
      created_at: now
    })

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('LEFT JOIN "public"."gene_list_items" gli'),
      []
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM "public"."gene_lists" WHERE id = $1',
      [1]
    )
  })

  it('creates, lists, deletes, and imports region file entries transactionally', async () => {
    const { client, pool } = makePool()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: '1' }] }
      if (sql.includes('SELECT * FROM "public"."region_files"')) {
        return { rows: [{ id: '1', name: 'Exome BED', region_count: '2', total_bases: '150' }] }
      }
      return { rows: [] }
    })
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: '1', name: 'Exome BED', region_count: '0', total_bases: '0' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: '1', name: 'Exome BED', region_count: '2', total_bases: '150' }]
      })
      .mockResolvedValueOnce({ rows: [] })
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.createRegionFile('Exome BED', null)).resolves.toMatchObject({
      id: 1,
      region_count: 0,
      total_bases: 0
    })
    const bedPath = join(tempDir, 'regions.bed')
    writeFileSync(bedPath, '1\t100\t200\tA\n2\t20\t70\n')
    await expect(repo.importBedFile(1, bedPath)).resolves.toMatchObject({
      id: 1,
      region_count: 2,
      total_bases: 150
    })
    await expect(repo.listRegionFiles()).resolves.toStrictEqual([
      { id: 1, name: 'Exome BED', region_count: 2, total_bases: 150 }
    ])
    await repo.deleteRegionFile(1)

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO "public"."region_files"'),
      ['Exome BED', null, now]
    )
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM "public"."region_file_entries" WHERE region_file_id = $1',
      [1]
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UNNEST($2::text[], $3::bigint[], $4::bigint[], $5::text[])'),
      [1, ['1', '2'], [100, 20], [200, 70], ['A', null]]
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET region_count = $1, total_bases = $2, updated_at = $3'),
      [2, 150, now, 1]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM "public"."region_files" WHERE id = $1',
      [1]
    )
  })

  it('persists large region files in bounded parameter chunks', async () => {
    const { client, pool } = makePool()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: '1' }] }
      if (sql.includes('SELECT * FROM "public"."region_files"')) {
        return {
          rows: [
            {
              id: '1',
              name: 'Large BED',
              region_count: String(REGION_FILE_INSERT_CHUNK_SIZE + 1),
              total_bases: String(REGION_FILE_INSERT_CHUNK_SIZE + 1)
            }
          ]
        }
      }
      return { rows: [] }
    })
    const entryCount = REGION_FILE_INSERT_CHUNK_SIZE + 1
    const bedPath = join(tempDir, 'large.bed')
    writeFileSync(
      bedPath,
      Array.from({ length: entryCount }, (_, index) => `1\t${index * 2}\t${index * 2 + 1}`)
        .join('\n')
        .concat('\n')
    )
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await repo.importBedFile(1, bedPath)

    const insertCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('UNNEST($2::text[], $3::bigint[], $4::bigint[], $5::text[])')
    )
    expect(insertCalls).toHaveLength(2)
    expect(insertCalls.map(([, params]) => (params as unknown[][])[1].length)).toEqual([
      REGION_FILE_INSERT_CHUNK_SIZE,
      1
    ])
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET region_count = $1, total_bases = $2, updated_at = $3'),
      [entryCount, entryCount, now, 1]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('rolls back a strict BED replacement when streaming encounters a malformed row', async () => {
    const { client, pool } = makePool()
    const bedPath = join(tempDir, 'malformed.bed')
    writeFileSync(bedPath, '1\t0\t10\n1\tbad\t20\n')
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.importBedFile(1, bedPath, { rejectMalformedRows: true })).rejects.toThrow(
      /invalid bed row/i
    )

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM "public"."region_file_entries" WHERE region_file_id = $1',
      [1]
    )
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('locks the parent region file before replacing rows', async () => {
    const { client, pool } = makePool()
    const bedPath = join(tempDir, 'locked.bed')
    writeFileSync(bedPath, '1\t0\t10\n')
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await repo.importBedFile(1, bedPath)

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT id FROM "public"."region_files" WHERE id = $1 FOR UPDATE'),
      [1]
    )
    expect(String(client.query.mock.calls[2]?.[0])).toContain('region_file_entries')
  })

  it('fails a BED replacement when the locked parent row does not exist', async () => {
    const { client, pool } = makePool()
    client.query.mockResolvedValue({ rows: [] })
    const bedPath = join(tempDir, 'missing-parent.bed')
    writeFileSync(bedPath, '1\t0\t10\n')
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.importBedFile(99, bedPath)).rejects.toThrow(/region file 99 not found/i)

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining('FOR UPDATE'), [99])
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('region_file_entries'),
      expect.anything()
    )
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
  })

  it('rolls back replace operations and releases clients', async () => {
    const { client, pool } = makePool()
    const insertError = new Error('insert failed')
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(insertError)
    const repo = new PostgresPanelsRepository(pool as never, 'public')

    await expect(repo.setGenes(1, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])).rejects.toBe(
      insertError
    )

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
