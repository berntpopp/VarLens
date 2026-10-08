import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe('variant search parity', () => {
  let sqlite: DatabaseService

  beforeEach(() => {
    sqlite = new DatabaseService(':memory:')
  })

  afterEach(() => {
    sqlite.close()
  })

  it('matches non-gene search terms through SQLite FTS and Postgres search_document', async () => {
    const caseId = sqlite.cases.createCase('search-parity', '/fixtures/search.vcf', 1024)
    const variants: Omit<Variant, 'id' | 'case_id'>[] = [
      {
        chr: '1',
        pos: 1000,
        ref: 'A',
        alt: 'G',
        gene_symbol: 'GENE1',
        consequence: 'stop_gained',
        gnomad_af: null,
        cadd: null,
        clinvar: null
      },
      {
        chr: '1',
        pos: 2000,
        ref: 'C',
        alt: 'T',
        gene_symbol: 'STOPLIKE_GENE',
        consequence: 'missense_variant',
        gnomad_af: null,
        cadd: null,
        clinvar: null
      }
    ]
    sqlite.variants.insertVariantsBatch(caseId, variants)
    const sqliteResults = sqlite.variants.searchVariants(caseId, 'stop', 20)

    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: sqliteResults.map((variant) => ({
          ...variant,
          internal_af: null
        }))
      })
    }
    const postgres = new PostgresVariantReadRepository(pool as never, 'public')
    const postgresResults = await postgres.searchVariants(caseId, 'stop', 20)

    expect(sqliteResults.map((variant) => variant.consequence)).toContain('stop_gained')
    expect(postgresResults.map((variant) => variant.consequence)).toEqual(
      sqliteResults.map((variant) => variant.consequence)
    )
    const sql = (pool.query.mock.calls[0][0] as { text: string }).text
    expect(sql).toContain('search_document @@')
    expect(sql).not.toContain('gene_symbol ILIKE')
  })
})

/** The case-view search box (`search_query`) against both real backends. */
describe.skipIf(!RUN)('case-view search parity against a real Postgres (#503)', () => {
  const schema = `varlens_test_search_parity_${Date.now()}_${randomBytes(4).toString('hex')}`
  const variants = [
    {
      pos: 1000,
      gene_symbol: 'BRCA1',
      consequence: 'frameshift_variant',
      transcript: 'NM_007294.4',
      cdna: 'c.5266dupC',
      aa_change: 'p.Gln1756ProfsTer74'
    },
    {
      pos: 2000,
      gene_symbol: 'BRCA2',
      consequence: 'stop_gained',
      transcript: 'NM_000059.4',
      cdna: 'c.52660A>T',
      aa_change: 'p.Lys3326Ter'
    }
  ]
  let sqlite: DatabaseService
  let pool: Pool
  let sqliteCase: number
  let postgresCase: number

  beforeEach(async () => {
    sqlite = new DatabaseService(':memory:')
    sqliteCase = sqlite.cases.createCase('search-parity', '/fixtures/search.vcf', 1024)
    sqlite.variants.insertVariantsBatch(
      sqliteCase,
      variants.map((variant) => ({
        chr: '17',
        ref: 'A',
        alt: 'G',
        gnomad_af: null,
        cadd: null,
        clinvar: null,
        ...variant
      }))
    )

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const created = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ('search-parity', '/fixtures/search.vcf', 0, 0, 'GRCh38') RETURNING id`
    )
    postgresCase = created.rows[0].id
    for (const variant of variants) {
      await pool.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, consequence, transcript,
            cdna, aa_change)
         VALUES ($1, '17', $2, 'A', 'G', 'snv', $3, $4, $5, $6, $7)`,
        [
          postgresCase,
          variant.pos,
          variant.gene_symbol,
          variant.consequence,
          variant.transcript,
          variant.cdna,
          variant.aa_change
        ]
      )
    }
  }, 60_000)

  afterEach(async () => {
    sqlite.close()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
    await pool.end()
  }, 60_000)

  async function postgresHits(term: string): Promise<number[]> {
    const postgres = new PostgresVariantReadRepository(pool, schema)
    const page = await postgres.queryVariants({ case_id: postgresCase, search_query: term }, 20)
    return page.data.map((variant) => variant.pos).sort()
  }

  it.each(['stop', 'BRCA1', 'c.5266dupC', 'c.5266', 'p.Gln1756', 'c.9999'])(
    'finds the same variants for %s',
    async (term) => {
      const sqliteHits = sqlite.variants
        .getVariants({ case_id: sqliteCase, search_query: term }, 20)
        .data.map((variant) => variant.pos)
        .sort()

      expect(await postgresHits(term)).toEqual(sqliteHits)
    },
    60_000
  )

  it('finds a versioned transcript id', async () => {
    expect(await postgresHits('NM_007294.4')).toEqual([1000])
  }, 60_000)
})
