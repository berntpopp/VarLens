import { beforeEach, describe, expect, it, vi } from 'vitest'

const bulkCopyCalls: Array<{
  sql: string
  columnNames: string[]
  rows: Array<Record<string, unknown>>
}> = []

vi.mock('../../../src/main/storage/postgres/postgres-bulk-write', () => ({
  runBulkCopy: vi.fn(
    async (params: {
      sql: string
      columns: ReadonlyArray<{ name: string }>
      rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
    }) => {
      const collected: Array<Record<string, unknown>> = []
      // The runBulkCopy contract accepts both Iterable and AsyncIterable.
      // The repository hands plain arrays today, but we materialize via
      // for-await to also exercise the AsyncIterable contract for free.
      for await (const row of params.rows as AsyncIterable<Record<string, unknown>>) {
        collected.push(row)
      }
      bulkCopyCalls.push({
        sql: params.sql,
        columnNames: params.columns.map((c) => c.name),
        rows: collected
      })
    }
  )
}))

import {
  PostgresVcfImportRepository,
  type PostgresVcfImportRequest
} from '../../../src/main/storage/postgres/PostgresVcfImportRepository'
import { UniqueConstraintError } from '../../../src/main/database/errors'
import {
  VARIANT_COPY_COLUMNS,
  VARIANT_TRANSCRIPT_COPY_COLUMNS,
  VARIANT_SV_COPY_COLUMNS,
  VARIANT_STR_COPY_COLUMNS,
  VARIANT_CNV_COPY_COLUMNS
} from '../../../src/main/storage/postgres/postgres-import-columns'

interface RecordedQuery {
  text: string
  params?: unknown[]
}

const makeFakeClient = () => {
  const queries: Array<RecordedQuery> = []
  const client = {
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push({ text, params })
      // Case lookup (default: not found).
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) {
        return { rows: [] }
      }
      // Case insert.
      if (text.startsWith('INSERT INTO') && text.includes('"cases"')) {
        return { rows: [{ id: 31 }] }
      }
      // ID-reservation query: SELECT g.ord ... nextval(pg_get_serial_sequence...).
      // Returns { ordinal, id } rows aligned with the requested N.
      if (text.includes('pg_get_serial_sequence') && text.includes('generate_series')) {
        const n = (params?.[1] as number) ?? 0
        return {
          rows: Array.from({ length: n }, (_, i) => ({
            ordinal: String(i),
            id: String(1000 + i)
          }))
        }
      }
      // case_data_info upsert.
      if (text.startsWith('INSERT INTO') && text.includes('"case_data_info"')) {
        return { rows: [] }
      }
      // search_document bulk UPDATEs.
      if (text.startsWith('UPDATE') && text.includes('search_document')) {
        return { rows: [] }
      }
      return { rows: [] }
    })
  }
  return { client, queries }
}

beforeEach(() => {
  bulkCopyCalls.length = 0
})

describe('PostgresVcfImportRepository.writeVcfFile', () => {
  it('issues no transaction-lifecycle SQL', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    const req: PostgresVcfImportRequest = {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    }
    await repo.writeVcfFile(client as never, req)
    const texts = queries.map((q) => q.text)
    expect(texts).not.toContain('BEGIN')
    expect(texts).not.toContain('COMMIT')
    expect(texts).not.toContain('ROLLBACK')
    expect(queries.find((q) => q.text.includes('"variant_frequency"'))).toBeUndefined()
    // No COPY either when there are zero variants.
    expect(bulkCopyCalls).toHaveLength(0)
  })

  it('rejects pre-existing case in multi-file mode at file index 0', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementationOnce(async () => ({ rows: [{ id: 99 }] }))
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'multi-file',
        fileIndex: 0,
        caseName: 'PreExisting',
        fileName: 'a.vcf.gz',
        filePath: '/tmp/a.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('looks up case by name at fileIndex >= 1 instead of inserting', async () => {
    const { client, queries } = makeFakeClient()
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : (sql as { text: string }).text
      queries.push({ text })
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"'))
        return { rows: [{ id: 7 }] }
      return { rows: [] }
    })
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'multi-file',
      fileIndex: 1,
      caseName: 'Multi',
      fileName: 'b.vcf.gz',
      filePath: '/tmp/b.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    expect(
      queries.find((q) => q.text.startsWith('INSERT INTO') && q.text.includes('"cases"'))
    ).toBeUndefined()
  })

  it('single-file mode rejects pre-existing case name', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementationOnce(async () => ({ rows: [{ id: 55 }] }))
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'single-file',
        caseName: 'Existing',
        fileName: 'a.vcf.gz',
        filePath: '/tmp/a.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('multi-file fileIndex >= 1 rejects when case does not exist', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : (sql as { text: string }).text
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      return { rows: [] }
    })
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'multi-file',
        fileIndex: 1,
        caseName: 'Missing',
        fileName: 'b.vcf.gz',
        filePath: '/tmp/b.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toThrow(/case 'Missing' not found/)
  })

  it('writes a case_data_info row per call', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'CDI',
      fileName: 'test.vcf.gz',
      filePath: '/tmp/test.vcf.gz',
      fileSize: 100,
      genomeBuild: 'GRCh38',
      caller: 'gatk',
      annotationFormat: 'vep',
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    const cdiInsert = queries.find(
      (q) => q.text.includes('"case_data_info"') && q.text.startsWith('INSERT INTO')
    )
    expect(cdiInsert).toBeDefined()
  })

  it('COPYs base variants and extension rows with pre-reserved IDs', async () => {
    const { client } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ],
      transcripts: [{ ordinal: 0, transcript_id: 'ENST1', gene_symbol: 'BRCA1', is_selected: 1 }],
      sv: [],
      cnv: [],
      str: []
    })

    const variantsCopy = bulkCopyCalls.find((c) => c.sql.includes('"variants_all"'))
    expect(variantsCopy).toBeDefined()
    expect(variantsCopy!.columnNames).toEqual(VARIANT_COPY_COLUMNS as unknown as string[])
    // First two columns are id, case_id.
    expect(variantsCopy!.columnNames[0]).toBe('id')
    expect(variantsCopy!.columnNames[1]).toBe('case_id')
    expect(variantsCopy!.rows).toHaveLength(2)
    // Pre-reserved IDs are 1000, 1001 (mock returns 1000 + i).
    expect(variantsCopy!.rows[0].id).toBe(1000n)
    expect(variantsCopy!.rows[1].id).toBe(1001n)

    const transcriptsCopy = bulkCopyCalls.find((c) => c.sql.includes('"variant_transcripts"'))
    expect(transcriptsCopy).toBeDefined()
    expect(transcriptsCopy!.columnNames).toEqual(
      VARIANT_TRANSCRIPT_COPY_COLUMNS as unknown as string[]
    )
    expect(transcriptsCopy!.rows).toHaveLength(1)
    expect(transcriptsCopy!.rows[0].variant_id).toBe(1000n)
  })

  it('correlates variant_id from pre-reserved IDs into extension rows by ordinal', async () => {
    const { client } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf',
      filePath: '/tmp/a.vcf',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ],
      transcripts: [
        { ordinal: 0, transcript_id: 'ENST1' },
        { ordinal: 1, transcript_id: 'ENST2' }
      ],
      sv: [],
      cnv: [],
      str: []
    })

    const transcriptsCopy = bulkCopyCalls.find((c) => c.sql.includes('"variant_transcripts"'))
    expect(transcriptsCopy).toBeDefined()
    expect(transcriptsCopy!.rows).toHaveLength(2)
    expect(transcriptsCopy!.rows[0].variant_id).toBe(1000n)
    expect(transcriptsCopy!.rows[1].variant_id).toBe(1001n)
  })

  it('issues no UPDATE for search_document — generated column populates inline', async () => {
    // Phase 16.1: search_document on variants/variant_sv/variant_str is a
    // STORED generated column. The repository writes the COPY data and
    // moves on; Postgres computes search_document automatically.
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'SD',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ],
      transcripts: [],
      sv: [{ ordinal: 0, sv_is_precise: 1 }],
      cnv: [],
      str: []
    })

    const searchDocUpdate = queries.find(
      (q) => q.text.startsWith('UPDATE') && q.text.includes('search_document')
    )
    expect(searchDocUpdate).toBeUndefined()
  })

  it('regression guard: COPY column lists exclude coord_hash and search_document', () => {
    expect(VARIANT_COPY_COLUMNS as unknown as string[]).not.toContain('coord_hash')
    expect(VARIANT_COPY_COLUMNS as unknown as string[]).not.toContain('search_document')
    expect(VARIANT_SV_COPY_COLUMNS as unknown as string[]).not.toContain('coord_hash')
    expect(VARIANT_SV_COPY_COLUMNS as unknown as string[]).not.toContain('search_document')
    expect(VARIANT_STR_COPY_COLUMNS as unknown as string[]).not.toContain('coord_hash')
    expect(VARIANT_STR_COPY_COLUMNS as unknown as string[]).not.toContain('search_document')
    expect(VARIANT_TRANSCRIPT_COPY_COLUMNS as unknown as string[]).not.toContain('coord_hash')
    expect(VARIANT_TRANSCRIPT_COPY_COLUMNS as unknown as string[]).not.toContain('search_document')
    expect(VARIANT_CNV_COPY_COLUMNS as unknown as string[]).not.toContain('coord_hash')
    expect(VARIANT_CNV_COPY_COLUMNS as unknown as string[]).not.toContain('search_document')
  })
})
