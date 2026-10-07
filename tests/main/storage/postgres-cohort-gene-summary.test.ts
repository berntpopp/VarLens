/**
 * Maintained per-gene cohort aggregates (migration 0023,
 * src/main/storage/postgres/cohort-gene-summary-sql.ts).
 *
 * The gene-burden table and the cohort tiles used to scan every variant row.
 * They now read maintained tables, and must return exactly what those scans
 * returned. The original scanning SQL is kept here as the oracle and compared
 * after every step of a mixed sequence of publications, deletions and
 * transcript switches; at the end the maintained tables must equal a rebuild.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1 (same harness as cohort-summary-drift).
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import { PostgresOverviewRepository } from '../../../src/main/storage/postgres/PostgresOverviewRepository'
import { PostgresTranscriptsRepository } from '../../../src/main/storage/postgres/PostgresTranscriptsRepository'
import { lockSummaryForWrite } from '../../../src/main/storage/postgres/cohort-summary-lock'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

/** [chr, pos, ref, alt, gene, variant_type?] */
type Row = [string, number, string, string, string | null, string?]

describe.skipIf(!RUN)('per-gene cohort aggregates', () => {
  let schema: string
  let pool: Pool
  const summary = new PostgresCohortSummaryRepository()

  async function createSchema(migrations = POSTGRES_MIGRATIONS): Promise<void> {
    schema = `varlens_test_gene_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, migrations).migrate()
  }

  beforeEach(async () => {
    await createSchema()
  }, 60_000)

  afterEach(async () => {
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  const t = (table: string): string => `"${schema}"."${table}"`

  /** A case as an import leaves it before publication: hidden, with its rows. */
  async function seedCase(
    name: string,
    build: string,
    rows: Row[],
    status = 'importing'
  ): Promise<number> {
    const res = await pool.query<{ id: number }>(
      `INSERT INTO ${t('cases_all')}
         (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
       VALUES ($1, $2, 0, $3, $4, $5, $6) RETURNING id`,
      [name, `/tmp/${name}.vcf`, rows.length, Date.now(), build, status]
    )
    const caseId = Number(res.rows[0].id)
    for (const [chr, pos, ref, alt, gene, type] of rows) {
      await pool.query(
        `INSERT INTO ${t('variants_all')}
           (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '0/1')`,
        [caseId, chr, pos, ref, alt, type ?? 'snv', gene]
      )
    }
    return caseId
  }

  /** The publication transaction of an import, reduced to the summary part. */
  async function publish(caseId: number): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await lockSummaryForWrite(client, schema)
      await summary.incrementalAdd({ schema, client, caseId, includeProvisional: true })
      await client.query(`UPDATE ${t('cases_all')} SET import_status = 'ready' WHERE id = $1`, [
        caseId
      ])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  }

  async function hide(caseId: number): Promise<void> {
    const result = await new PostgresCaseLifecycleRepository(pool, schema).hideCase(caseId)
    expect(result.state).toBe('hidden')
  }

  // ── The original scanning queries, verbatim: the oracle. ─────────────────
  async function scannedGeneBurden(): Promise<unknown[]> {
    const res = await pool.query(
      `SELECT
         v.gene_symbol,
         COUNT(*)::bigint AS variant_count,
         COUNT(DISTINCT (v.chr, v.pos, v.ref, v.alt))::bigint AS unique_variant_count,
         COUNT(DISTINCT v.case_id)::bigint AS affected_case_count,
         (SELECT COUNT(*)::bigint FROM ${t('cases')}) AS total_cases
       FROM ${t('variants')} v
       WHERE v.gene_symbol IS NOT NULL AND v.gene_symbol <> ''
       GROUP BY v.gene_symbol
       ORDER BY v.gene_symbol`
    )
    return res.rows.map((row) => ({
      gene_symbol: row.gene_symbol,
      variant_count: Number(row.variant_count),
      unique_variant_count: Number(row.unique_variant_count),
      affected_case_count: Number(row.affected_case_count),
      total_cases: Number(row.total_cases)
    }))
  }

  async function scannedTotals(): Promise<Record<string, number>> {
    const res = await pool.query(
      `SELECT
         (SELECT COUNT(*)::bigint FROM ${t('variants')}) AS total_variants,
         (SELECT COUNT(*)::bigint FROM (
            SELECT 1 FROM ${t('variants')} v GROUP BY v.chr, v.pos, v.ref, v.alt
          ) unique_variants) AS unique_variants,
         (SELECT COUNT(DISTINCT v.gene_symbol)::bigint FROM ${t('variants')} v
           WHERE v.gene_symbol IS NOT NULL) AS genes_with_variants`
    )
    return {
      total_variants: Number(res.rows[0].total_variants),
      unique_variants: Number(res.rows[0].unique_variants),
      genes_with_variants: Number(res.rows[0].genes_with_variants)
    }
  }

  async function expectReadsMatchScans(step: string): Promise<void> {
    const cohort = new PostgresCohortRepository(pool, schema)
    const burden = await cohort.getGeneBurden()
    const byGene = [...burden].sort((a, b) => (a.gene_symbol < b.gene_symbol ? -1 : 1))
    expect(byGene, `gene burden after ${step}`).toEqual(await scannedGeneBurden())
    // Ordering contract of the read: most affected cases, then most rows.
    for (let i = 1; i < burden.length; i++) {
      const [prev, cur] = [burden[i - 1], burden[i]]
      expect(
        prev.affected_case_count > cur.affected_case_count ||
          (prev.affected_case_count === cur.affected_case_count &&
            prev.variant_count >= cur.variant_count)
      ).toBe(true)
    }

    const totals = await scannedTotals()
    const tiles = await cohort.getSummary()
    expect(
      {
        total_variants: tiles.total_variants,
        unique_variants: tiles.unique_variants,
        genes_with_variants: tiles.genes_with_variants
      },
      `cohort tiles after ${step}`
    ).toEqual(totals)

    const overview = await new PostgresOverviewRepository(pool, schema).getOverview()
    expect(
      {
        total_variants: overview.summary.total_variants,
        unique_variants: overview.summary.unique_variants,
        genes_with_variants: overview.summary.genes_with_variants
      },
      `overview after ${step}`
    ).toEqual(totals)
  }

  async function snapshotGeneTables(): Promise<{ genes: unknown[]; pairs: unknown[] }> {
    const genes = await pool.query(
      `SELECT gene_symbol, variant_count::int, unique_variant_count::int, affected_case_count::int
         FROM ${t('cohort_gene_summary')} ORDER BY gene_symbol`
    )
    const pairs = await pool.query(
      `SELECT gene_symbol, chr, pos, ref, alt, carrier_count::int
         FROM ${t('cohort_gene_variant_summary')} ORDER BY gene_symbol, chr, pos, ref, alt`
    )
    return { genes: genes.rows, pairs: pairs.rows }
  }

  async function rebuild(): Promise<void> {
    const client = await pool.connect()
    try {
      await summary.rebuild({ schema, client })
    } finally {
      client.release()
    }
  }

  it('returns what the scanning queries return after mixed adds, removals and gene switches', async () => {
    const a = await seedCase('a', 'GRCh38', [
      ['1', 100, 'A', 'T', 'GENE1'],
      ['1', 100, 'A', 'T', 'GENE1'], // duplicate row: counts twice as a row, once as a case
      ['1', 200, 'C', 'G', 'GENE1'],
      ['2', 300, 'G', 'A', null],
      ['2', 400, 'T', 'C', ''],
      ['3', 500, 'A', 'G', 'GENE2']
    ])
    const b = await seedCase('b', 'GRCh38', [
      ['1', 100, 'A', 'T', 'GENE1B'], // same coordinate, annotated with another gene
      ['1', 200, 'C', 'G', 'GENE1'],
      ['2', 400, 'T', 'C', ''],
      ['3', 500, 'A', 'G', 'GENE2']
    ])
    const c = await seedCase('c', 'GRCh37', [
      ['1', 100, 'A', 'T', 'GENE1'], // same coordinate on another genome build
      ['2', 300, 'G', 'A', null],
      ['4', 600, 'C', 'T', 'GENE3']
    ])
    const d = await seedCase('d', 'GRCh38', [
      ['1', 100, 'A', 'T', 'GENE1', 'sv'], // same coordinate under another variant type
      ['4', 600, 'C', 'T', 'GENE3'],
      ['4', 600, 'C', 'T', 'GENE3'],
      ['5', 700, 'G', 'C', 'GENE4']
    ])
    const e = await seedCase('e', 'GRCh38', [
      ['1', 100, 'A', 'T', 'GENE1B'],
      ['5', 700, 'G', 'C', 'GENE4'],
      ['6', 800, 'T', 'A', 'GENE5']
    ])

    await expectReadsMatchScans('nothing published')
    await publish(a)
    await expectReadsMatchScans('publishing a')
    await publish(b)
    await expectReadsMatchScans('publishing b')
    await publish(c)
    await expectReadsMatchScans('publishing c')
    await hide(a)
    await expectReadsMatchScans('deleting a')
    await publish(d)
    await expectReadsMatchScans('publishing d')

    // A transcript switch moves one row of d from GENE3 to GENE4 while a
    // duplicate row of the same coordinate stays on GENE3, then moves it too.
    const transcripts = new PostgresTranscriptsRepository(pool, schema)
    const gene3Rows = await pool.query<{ id: number }>(
      `SELECT id FROM ${t('variants')} WHERE case_id = $1 AND gene_symbol = 'GENE3' ORDER BY id`,
      [d]
    )
    const other = {
      consequence: 'HIGH',
      func: 'stop_gained',
      cdna: null,
      aa_change: null,
      hpo_sim_score: null,
      moi: null
    }
    for (const [index, row] of gene3Rows.rows.entries()) {
      await transcripts.insertTranscriptAndSwitch(Number(row.id), {
        ...other,
        transcript_id: 'NM_GENE4.1',
        gene_symbol: 'GENE4'
      } as never)
      await expectReadsMatchScans(`switching GENE3 row ${index} of d to GENE4`)
    }
    // … and to a gene that did not exist, then to no gene at all.
    await transcripts.insertTranscriptAndSwitch(Number(gene3Rows.rows[0].id), {
      ...other,
      transcript_id: 'NM_GENE9.1',
      gene_symbol: 'GENE9'
    } as never)
    await expectReadsMatchScans('switching a row to a new gene')
    await transcripts.insertTranscriptAndSwitch(Number(gene3Rows.rows[0].id), {
      ...other,
      transcript_id: 'NM_NONE.1',
      gene_symbol: null
    } as never)
    await expectReadsMatchScans('switching a row to no gene')

    await hide(c)
    await expectReadsMatchScans('deleting c')
    await publish(e)
    await expectReadsMatchScans('publishing e')
    await hide(b)
    await expectReadsMatchScans('deleting b')

    // Nothing above went through a rebuild: the figures were maintained.
    const state = await pool.query(
      `SELECT last_rebuilt_at, is_stale FROM ${t('cohort_summary_state')} WHERE id = 1`
    )
    expect(state.rows[0]).toEqual({ last_rebuilt_at: null, is_stale: false })

    const maintained = await snapshotGeneTables()
    expect(maintained.genes.length).toBeGreaterThan(0)
    await rebuild()
    expect(await snapshotGeneTables()).toEqual(maintained)
    await expectReadsMatchScans('rebuild')

    // Deleting everything leaves no rows behind.
    await hide(d)
    await hide(e)
    expect(await snapshotGeneTables()).toEqual({ genes: [], pairs: [] })
    await expectReadsMatchScans('deleting every case')
  }, 120_000)

  it('incrementalRemove is the inverse of incrementalAdd for the gene tables', async () => {
    const a = await seedCase('a', 'GRCh38', [['1', 100, 'A', 'T', 'GENE1']], 'ready')
    const b = await seedCase(
      'b',
      'GRCh38',
      [
        ['1', 100, 'A', 'T', 'GENE1'],
        ['1', 100, 'A', 'T', 'GENE1'],
        ['2', 200, 'C', 'G', 'GENE2']
      ],
      'ready'
    )
    await rebuild()
    const before = await snapshotGeneTables()

    const client = await pool.connect()
    try {
      for (const caseId of [a, b, b, a]) {
        await summary.incrementalRemove({ schema, client, caseId })
        await summary.incrementalAdd({ schema, client, caseId })
      }
    } finally {
      client.release()
    }
    expect(await snapshotGeneTables()).toEqual(before)
  })

  it('publishing a case does not rewrite gene rows it does not touch', async () => {
    const versions = async (): Promise<Map<string, string>> => {
      const genes = await pool.query(
        `SELECT 'gene:' || gene_symbol AS key, xmin::text || '/' || ctid::text AS version
           FROM ${t('cohort_gene_summary')}
         UNION ALL
         SELECT 'pair:' || gene_symbol || ':' || chr || ':' || pos, xmin::text || '/' || ctid::text
           FROM ${t('cohort_gene_variant_summary')}`
      )
      return new Map(genes.rows.map((row) => [row.key as string, row.version as string]))
    }

    await publish(
      await seedCase('a', 'GRCh38', [
        ['1', 100, 'A', 'T', 'SHARED'],
        ['2', 200, 'C', 'G', 'UNTOUCHED'],
        ['3', 300, 'G', 'A', 'UNTOUCHED2']
      ])
    )
    const before = await versions()

    await publish(
      await seedCase('b', 'GRCh38', [
        ['1', 100, 'A', 'T', 'SHARED'],
        ['4', 400, 'T', 'C', 'NEW']
      ])
    )
    const after = await versions()

    for (const key of ['gene:UNTOUCHED', 'gene:UNTOUCHED2', 'pair:UNTOUCHED:2:200']) {
      expect(after.get(key), key).toBe(before.get(key))
    }
    expect(after.get('gene:SHARED')).not.toBe(before.get('gene:SHARED'))
    expect(after.has('gene:NEW')).toBe(true)
    await expectReadsMatchScans('second publication')
  })

  it('migration 0023 fills the aggregates of a database that already holds variants', async () => {
    // Replace the migrated schema by one stopped just before 0023.
    await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
    const before0023 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0023')
    await createSchema(before0023)

    await seedCase(
      'visible',
      'GRCh38',
      [
        ['1', 100, 'A', 'T', 'GENE1'],
        ['1', 100, 'A', 'T', 'GENE1'],
        ['2', 200, 'C', 'G', ''],
        ['3', 300, 'G', 'A', null]
      ],
      'ready'
    )
    await seedCase('visible-2', 'GRCh37', [['1', 100, 'A', 'T', 'GENE1B']], 'ready')
    // A case still being imported is not part of the cohort yet.
    await seedCase('importing', 'GRCh38', [['9', 900, 'A', 'T', 'HIDDEN']], 'importing')
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const migrated = await snapshotGeneTables()
    expect(migrated.genes).toEqual([
      { gene_symbol: '', variant_count: 1, unique_variant_count: 1, affected_case_count: 1 },
      { gene_symbol: 'GENE1', variant_count: 2, unique_variant_count: 1, affected_case_count: 1 },
      { gene_symbol: 'GENE1B', variant_count: 1, unique_variant_count: 1, affected_case_count: 1 }
    ])
    const state = await pool.query(
      `SELECT last_rebuilt_at, is_stale FROM ${t('cohort_summary_state')} WHERE id = 1`
    )
    expect(state.rows[0].is_stale).toBe(false)
    expect(await scannedGeneBurden()).toEqual(
      (
        await pool.query(
          `SELECT gene_symbol, variant_count::int, unique_variant_count::int,
                affected_case_count::int, 2 AS total_cases
           FROM ${t('cohort_gene_summary')} WHERE gene_symbol <> '' ORDER BY gene_symbol`
        )
      ).rows
    )
    await rebuild()
    expect(await snapshotGeneTables()).toEqual(migrated)
  }, 120_000)

  it('a read rebuilds when the gene aggregates are missing for a populated summary', async () => {
    await publish(await seedCase('a', 'GRCh38', [['1', 100, 'A', 'T', 'GENE1']]))
    const filled = await snapshotGeneTables()
    // E.g. a restore that left the derived gene tables out.
    await pool.query(`DELETE FROM ${t('cohort_gene_summary')}`)
    await pool.query(`DELETE FROM ${t('cohort_gene_variant_summary')}`)

    await expectReadsMatchScans('emptying the gene tables')
    expect(await snapshotGeneTables()).toEqual(filled)
  })
})

describe.skipIf(RUN)('per-gene cohort aggregates (skipped)', () => {
  it('is gated by VARLENS_RUN_POSTGRES_E2E=1', () => {
    expect(RUN).toBe(false)
  })
})
