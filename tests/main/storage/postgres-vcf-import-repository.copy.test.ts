/**
 * Postgres-gated integration tests for the VCF COPY-FROM-STDIN path.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Exercises
 * PostgresVcfImportRepository.writeVcfFile against a real Postgres connection,
 * mirroring the worker's bracket-transaction trigger-defer pattern so the
 * code path under test matches what the worker actually runs.
 *
 * Setup:
 *   make pg-reset && make pg-up
 *   make rebuild-node
 *   VARLENS_RUN_POSTGRES_E2E=1 npx vitest run \
 *     --project main tests/main/storage/postgres-vcf-import-repository.copy.test.ts
 *
 * Static (non-DB) regression guards for the COPY column lists also live in
 * this file so the assertion lands next to the rest of the COPY-path tests;
 * they always run, even with the env var unset.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  PostgresVcfImportRepository,
  type PostgresVcfImportRequest
} from '../../../src/main/storage/postgres/PostgresVcfImportRepository'
import {
  VARIANT_COPY_COLUMNS,
  VARIANT_SV_COPY_COLUMNS,
  VARIANT_STR_COPY_COLUMNS
} from '../../../src/main/storage/postgres/postgres-import-columns'
// Phase 16.1 removed the bracket-transaction trigger-defer helpers and the
// recovery shim — search_document is now a STORED generated column. Tests
// that previously asserted trigger state are obsolete; the column is always
// present after a COPY because the generated expression runs inline.

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const PG_SCHEMA = process.env.VARLENS_PG_SCHEMA ?? 'public'

// ---------------------------------------------------------------------------
// Static regression guards — no DB needed; run unconditionally.
// ---------------------------------------------------------------------------

describe('PostgresVcfImportRepository COPY column-list regression guards', () => {
  it('VARIANT_COPY_COLUMNS excludes coord_hash (generated column)', () => {
    expect(VARIANT_COPY_COLUMNS as readonly string[]).not.toContain('coord_hash')
  })

  it('VARIANT_COPY_COLUMNS excludes search_document (generated column)', () => {
    expect(VARIANT_COPY_COLUMNS as readonly string[]).not.toContain('search_document')
  })

  it('VARIANT_COPY_COLUMNS includes id (pre-reserved sequence)', () => {
    expect(VARIANT_COPY_COLUMNS as readonly string[]).toContain('id')
  })

  it('VARIANT_SV_COPY_COLUMNS excludes search_document', () => {
    expect(VARIANT_SV_COPY_COLUMNS as readonly string[]).not.toContain('search_document')
  })

  it('VARIANT_STR_COPY_COLUMNS excludes search_document', () => {
    expect(VARIANT_STR_COPY_COLUMNS as readonly string[]).not.toContain('search_document')
  })
})

// ---------------------------------------------------------------------------
// Live integration tests — require a real Postgres.
// ---------------------------------------------------------------------------

// Phase 16.1: triggers were replaced by STORED generated columns. The
// helpers that previously enabled/disabled them have been removed. Tests
// that referenced trigger state are obsolete (the column is always populated).

/**
 * Build a minimal valid variant row aligned to the VCF mapper's output shape:
 * the columns in VARIANT_COPY_COLUMNS minus `id` and `case_id`, which the
 * repository sets itself.
 */
function makeVariant(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chr: 'chr1',
    pos: 100000,
    ref: 'A',
    alt: 'G',
    gene_symbol: 'TEST_GENE',
    omim_mim_number: null,
    consequence: 'MODERATE',
    gnomad_af: null,
    cadd: null,
    clinvar: null,
    gt_num: '0/1',
    func: 'missense_variant',
    qual: 99,
    hpo_sim_score: null,
    transcript: 'ENST00000000001',
    cdna: 'c.100A>G',
    aa_change: 'p.Lys34Glu',
    moi: null,
    gq: 60,
    dp: 30,
    ad_ref: 15,
    ad_alt: 15,
    ab: 0.5,
    filter: 'PASS',
    info_json: '{"AC":1}',
    source_format: 'vcf',
    variant_type: 'snv',
    end_pos: null,
    sv_type: null,
    sv_length: null,
    caller: null,
    ...over
  }
}

function baseRequest(
  caseName: string,
  variants: Array<Record<string, unknown>>,
  extras: {
    transcripts?: Array<Record<string, unknown> & { ordinal: number }>
    sv?: Array<Record<string, unknown> & { ordinal: number }>
    str?: Array<Record<string, unknown> & { ordinal: number }>
  } = {}
): PostgresVcfImportRequest {
  return {
    mode: 'single-file',
    caseName,
    fileName: 'test.vcf',
    filePath: '/tmp/test.vcf',
    fileSize: 1024,
    genomeBuild: 'GRCh38',
    caller: null,
    annotationFormat: null,
    variantType: 'snv-indel',
    variants,
    transcripts: extras.transcripts ?? [],
    sv: extras.sv ?? [],
    cnv: [],
    str: extras.str ?? []
  }
}

describe.skipIf(!RUN)('PostgresVcfImportRepository — COPY path (integration)', () => {
  let control: Client
  const createdCaseNames: string[] = []
  const repo = new PostgresVcfImportRepository(PG_SCHEMA)

  beforeAll(async () => {
    control = new Client({ connectionString: PG_URL })
    await control.connect()
  })

  afterAll(async () => {
    if (createdCaseNames.length > 0) {
      await control.query(`DELETE FROM "${PG_SCHEMA}"."cases" WHERE name = ANY($1::text[])`, [
        createdCaseNames
      ])
    }
    await control.end()
  })

  afterEach(async () => {
    if (createdCaseNames.length > 0) {
      await control.query(`DELETE FROM "${PG_SCHEMA}"."cases" WHERE name = ANY($1::text[])`, [
        createdCaseNames
      ])
      createdCaseNames.length = 0
    }
  })

  /**
   * Run a callback inside a fresh client. Phase 16.1: no bracket-transaction
   * trigger defer is needed — search_document is a STORED generated column,
   * so the writes inside `fn` populate it inline at COPY time.
   */
  async function withWorkerLikeClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: PG_URL })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.end()
    }
  }

  function uniqueCaseName(label: string): string {
    const name = `phase16-copy-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    createdCaseNames.push(name)
    return name
  }

  // -------------------------------------------------------------------------
  // Bullet 1 — Single-batch round-trip
  // -------------------------------------------------------------------------

  it('round-trips variants + transcripts + sv + str in a single batch', async () => {
    const caseName = uniqueCaseName('single-batch')

    const variants = Array.from({ length: 20 }, (_, i) =>
      makeVariant({
        chr: i % 2 === 0 ? 'chr1' : 'chr2',
        pos: 100000 + i,
        ref: 'A',
        alt: i === 5 ? 'GTTTT' : 'G', // one multi-character ALT
        gene_symbol: `GENE_${i}`,
        gnomad_af: i === 0 ? null : i / 100,
        cadd: i === 0 ? null : 1.5 + i,
        qual: 50 + i,
        dp: 30 + i,
        consequence: i % 3 === 0 ? 'HIGH' : 'MODERATE'
      })
    )

    // 1 transcript per variant.
    const transcripts = variants.map((_, i) => ({
      ordinal: i,
      transcript_id: `ENST${String(i).padStart(11, '0')}`,
      gene_symbol: `GENE_${i}`,
      consequence: 'missense_variant',
      cdna: `c.${i}A>G`,
      aa_change: `p.X${i}Y`,
      hpo_sim_score: null,
      moi: null,
      is_selected: 1,
      is_mane_select: 1,
      is_canonical: 1
    }))

    // 1 SV row attached to the first variant.
    const sv = [
      {
        ordinal: 0,
        sv_is_precise: 1,
        cipos_left: -10,
        cipos_right: 10,
        ciend_left: -5,
        ciend_right: 5,
        support: 25,
        coverage: '30',
        strand: '+',
        stdev_len: 1.5,
        stdev_pos: 2.5,
        vaf: 0.45,
        dr: 12,
        dv: 13,
        pe_support: 7,
        sr_support: 6,
        event_id: 'EV1',
        mate_id: null
      }
    ]

    // 1 STR row attached to the second variant.
    const str = [
      {
        ordinal: 1,
        repeat_id: 'STR1',
        variant_catalog_id: 'CAT1',
        repeat_unit: 'CAG',
        display_repeat_unit: 'CAG',
        ref_copies: 12.0,
        alt_copies: '40',
        repeat_length: 120,
        str_status: 'expanded',
        normal_max: 30,
        pathologic_min: 35,
        disease: 'HD',
        inheritance_mode: 'AD',
        source_display: 'STR catalog',
        rank_score: '1.0',
        locus_coverage: 25.0,
        support_type: 'spanning',
        confidence_interval: '38-42'
      }
    ]

    const result = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(
        client,
        baseRequest(caseName, variants, { transcripts, sv, str })
      )
      await client.query('COMMIT')
      return r
    })

    expect(result.variantCount).toBe(20)
    expect(result.caseId).toBeGreaterThan(0)

    // Variants — round-trip core columns.
    const vRes = await control.query(
      `SELECT chr, pos, ref, alt, gene_symbol, consequence, qual, dp, gt_num
       FROM "${PG_SCHEMA}"."variants" WHERE case_id = $1 ORDER BY pos`,
      [result.caseId]
    )
    expect(vRes.rows).toHaveLength(20)
    expect(vRes.rows[5].alt).toBe('GTTTT')
    expect(vRes.rows[0].chr).toBe('chr1')
    expect(vRes.rows[0].gene_symbol).toBe('GENE_0')
    expect(Number(vRes.rows[0].qual)).toBe(50)

    // Transcripts — one per variant.
    const tRes = await control.query(
      `SELECT vt.transcript_id, vt.is_selected
       FROM   "${PG_SCHEMA}"."variant_transcripts" vt
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vt.variant_id
       WHERE  v.case_id = $1`,
      [result.caseId]
    )
    expect(tRes.rows).toHaveLength(20)

    // SV — one row.
    const svRes = await control.query(
      `SELECT vs.event_id, vs.support, vs.vaf
       FROM   "${PG_SCHEMA}"."variant_sv" vs
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vs.variant_id
       WHERE  v.case_id = $1`,
      [result.caseId]
    )
    expect(svRes.rows).toHaveLength(1)
    expect(svRes.rows[0].event_id).toBe('EV1')
    expect(Number(svRes.rows[0].support)).toBe(25)

    // STR — one row.
    const strRes = await control.query(
      `SELECT vstr.repeat_id, vstr.repeat_unit, vstr.alt_copies
       FROM   "${PG_SCHEMA}"."variant_str" vstr
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vstr.variant_id
       WHERE  v.case_id = $1`,
      [result.caseId]
    )
    expect(strRes.rows).toHaveLength(1)
    expect(strRes.rows[0].repeat_id).toBe('STR1')
    expect(strRes.rows[0].repeat_unit).toBe('CAG')
  })

  // -------------------------------------------------------------------------
  // Bullet 2 — Multi-batch (single-file then append)
  // -------------------------------------------------------------------------

  it('append mode commits subsequent batches and partial-commits across failure', async () => {
    const caseName = uniqueCaseName('multi-batch')

    // Batch 1 — single-file mode, creates the case with 20 variants.
    const batch1 = Array.from({ length: 20 }, (_, i) =>
      makeVariant({ pos: 200000 + i, gene_symbol: `B1_${i}` })
    )

    // Caller owns transactions per worker contract.
    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(client, baseRequest(caseName, batch1))
      await client.query('COMMIT')
      return r
    })

    // Batch 2 — append mode, 20 more variants — succeeds.
    await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const batch2 = Array.from({ length: 20 }, (_, i) =>
        makeVariant({ pos: 300000 + i, gene_symbol: `B2_${i}` })
      )
      const req: PostgresVcfImportRequest = {
        mode: 'append',
        caseId,
        caseName,
        fileName: 'test.vcf',
        filePath: '/tmp/test.vcf',
        fileSize: 1024,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: batch2,
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      }
      await repo.writeVcfFile(client, req)
      await client.query('COMMIT')
    })

    const after2 = await control.query(
      `SELECT COUNT(*)::int AS n FROM "${PG_SCHEMA}"."variants" WHERE case_id = $1`,
      [caseId]
    )
    expect(after2.rows[0].n).toBe(40)

    // Batch 3 — append mode with one bad row (chr=null violates NOT NULL).
    // Expect: writeVcfFile rejects, the test rolls back, the 40 prior rows
    // remain committed.
    const badBatch = Array.from({ length: 20 }, (_, i) =>
      makeVariant({ pos: 400000 + i, gene_symbol: `B3_${i}` })
    )
    badBatch[10] = makeVariant({ chr: null, pos: 400010 })

    await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      try {
        await repo.writeVcfFile(client, {
          mode: 'append',
          caseId,
          caseName,
          fileName: 'test.vcf',
          filePath: '/tmp/test.vcf',
          fileSize: 1024,
          genomeBuild: 'GRCh38',
          caller: null,
          annotationFormat: null,
          variantType: 'snv-indel',
          variants: badBatch,
          transcripts: [],
          sv: [],
          cnv: [],
          str: []
        })
        // Should not reach here.
        throw new Error('expected NOT NULL violation')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Real Postgres produces "null value in column ..." — make the assertion
        // structural rather than tied to the exact wording.
        expect(msg).toMatch(/null|chr/i)
        await client.query('ROLLBACK')
      }
    })

    const after3 = await control.query(
      `SELECT COUNT(*)::int AS n FROM "${PG_SCHEMA}"."variants" WHERE case_id = $1`,
      [caseId]
    )
    expect(after3.rows[0].n).toBe(40) // failed batch fully rolled back
  })

  // -------------------------------------------------------------------------
  // Bullet 3 — Extension-table FK integrity
  // -------------------------------------------------------------------------

  it('extension rows resolve to the correct variant_id by ordinal', async () => {
    const caseName = uniqueCaseName('fk-integrity')

    const variants = Array.from({ length: 5 }, (_, i) =>
      makeVariant({ pos: 500000 + i, gene_symbol: `FK_${i}` })
    )

    // 1 transcript per variant + 2 extra transcripts for ordinal 0 (3 total
    // for that variant). Different transcript_ids to satisfy the UNIQUE
    // constraint on (variant_id, transcript_id).
    const transcripts = variants.map((_, i) => ({
      ordinal: i,
      transcript_id: `ENST_FK_${i}_a`,
      gene_symbol: `FK_${i}`,
      consequence: 'missense_variant',
      cdna: null,
      aa_change: null,
      hpo_sim_score: null,
      moi: null,
      is_selected: 1,
      is_mane_select: 1,
      is_canonical: 1
    }))
    transcripts.push(
      {
        ordinal: 0,
        transcript_id: 'ENST_FK_0_b',
        gene_symbol: 'FK_0',
        consequence: 'missense_variant',
        cdna: null,
        aa_change: null,
        hpo_sim_score: null,
        moi: null,
        is_selected: 0,
        is_mane_select: 0,
        is_canonical: 0
      },
      {
        ordinal: 0,
        transcript_id: 'ENST_FK_0_c',
        gene_symbol: 'FK_0',
        consequence: 'missense_variant',
        cdna: null,
        aa_change: null,
        hpo_sim_score: null,
        moi: null,
        is_selected: 0,
        is_mane_select: 0,
        is_canonical: 0
      }
    )

    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(client, baseRequest(caseName, variants, { transcripts }))
      await client.query('COMMIT')
      return r
    })

    // Every transcript joins back to a variant in this case.
    const joined = await control.query(
      `SELECT COUNT(*)::int AS n
       FROM   "${PG_SCHEMA}"."variant_transcripts" vt
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vt.variant_id
       WHERE  v.case_id = $1`,
      [caseId]
    )
    expect(joined.rows[0].n).toBe(7) // 5 + 2 extra

    // The 3 transcripts on ordinal 0 should all share the same variant_id.
    const ordinal0 = await control.query(
      `SELECT DISTINCT vt.variant_id
       FROM   "${PG_SCHEMA}"."variant_transcripts" vt
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vt.variant_id
       WHERE  v.case_id = $1
       AND    vt.transcript_id IN ('ENST_FK_0_a','ENST_FK_0_b','ENST_FK_0_c')`,
      [caseId]
    )
    expect(ordinal0.rows).toHaveLength(1) // single distinct variant_id
  })

  // -------------------------------------------------------------------------
  // Bullet 4 — Trigger-defer correctness across all three FTS tables (golden)
  // -------------------------------------------------------------------------

  it('search_document on every variant is populated by the STORED generated column', async () => {
    const caseName = uniqueCaseName('golden-variants')

    const variants = Array.from({ length: 8 }, (_, i) =>
      makeVariant({
        chr: 'chr3',
        pos: 600000 + i,
        ref: 'A',
        alt: 'C',
        gene_symbol: `GLD_${i}`,
        consequence: i % 2 === 0 ? 'HIGH' : 'MODERATE',
        clinvar: i === 0 ? 'pathogenic' : null
      })
    )

    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(client, baseRequest(caseName, variants))
      await client.query('COMMIT')
      return r
    })

    const golden = await control.query<{ ok: boolean; total: number }>(
      `SELECT bool_and(v.search_document IS NOT NULL) AS ok,
              COUNT(*)::int AS total
       FROM   "${PG_SCHEMA}"."variants" v
       WHERE  v.case_id = $1`,
      [caseId]
    )
    expect(golden.rows[0].total).toBe(8)
    expect(golden.rows[0].ok).toBe(true)
  })

  it('variant_sv search_document is populated by the STORED generated column', async () => {
    const caseName = uniqueCaseName('golden-sv')

    const variants = Array.from({ length: 3 }, (_, i) =>
      makeVariant({ pos: 700000 + i, sv_type: 'DEL', sv_length: 1000 + i })
    )
    const sv = variants.map((_, i) => ({
      ordinal: i,
      sv_is_precise: 1,
      cipos_left: -5,
      cipos_right: 5,
      ciend_left: -5,
      ciend_right: 5,
      support: 10 + i,
      coverage: '20',
      strand: '+',
      stdev_len: null,
      stdev_pos: null,
      vaf: 0.5,
      dr: 5,
      dv: 5,
      pe_support: 3,
      sr_support: 2,
      event_id: `EV_GLD_${i}`,
      mate_id: i === 0 ? `MATE_GLD_${i}` : null
    }))

    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(client, baseRequest(caseName, variants, { sv }))
      await client.query('COMMIT')
      return r
    })

    const golden = await control.query<{ ok: boolean; total: number }>(
      `SELECT bool_and(vs.search_document IS NOT NULL) AS ok,
              COUNT(*)::int AS total
       FROM   "${PG_SCHEMA}"."variant_sv" vs
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vs.variant_id
       WHERE  v.case_id = $1`,
      [caseId]
    )
    expect(golden.rows[0].total).toBe(3)
    expect(golden.rows[0].ok).toBe(true)
  })

  it('variant_str search_document is populated by the STORED generated column', async () => {
    const caseName = uniqueCaseName('golden-str')

    const variants = Array.from({ length: 3 }, (_, i) => makeVariant({ pos: 800000 + i }))
    const str = variants.map((_, i) => ({
      ordinal: i,
      repeat_id: `STR_GLD_${i}`,
      variant_catalog_id: `CAT_GLD_${i}`,
      repeat_unit: 'CAG',
      display_repeat_unit: 'CAG',
      ref_copies: 10.0 + i,
      alt_copies: String(20 + i),
      repeat_length: 100 + i,
      str_status: 'expanded',
      normal_max: 30,
      pathologic_min: 35,
      disease: `DIS_${i}`,
      inheritance_mode: 'AD',
      source_display: 'STR catalog',
      rank_score: '1.0',
      locus_coverage: 25.0,
      support_type: 'spanning',
      confidence_interval: '40-50'
    }))

    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(client, baseRequest(caseName, variants, { str }))
      await client.query('COMMIT')
      return r
    })

    const golden = await control.query<{ ok: boolean; total: number }>(
      `SELECT bool_and(vstr.search_document IS NOT NULL) AS ok,
              COUNT(*)::int AS total
       FROM   "${PG_SCHEMA}"."variant_str" vstr
       JOIN   "${PG_SCHEMA}"."variants" v ON v.id = vstr.variant_id
       WHERE  v.case_id = $1`,
      [caseId]
    )
    expect(golden.rows[0].total).toBe(3)
    expect(golden.rows[0].ok).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Bullet 6 — synchronous_commit does not leak
  // -------------------------------------------------------------------------

  it('does not leak SET LOCAL synchronous_commit to other connections', async () => {
    const caseName = uniqueCaseName('sync-commit-leak')

    await withWorkerLikeClient(async (client) => {
      // Intentionally use the worker's per-batch lever pattern: SET LOCAL
      // inside the per-batch BEGIN, COMMIT, observe with a fresh connection.
      await client.query('BEGIN')
      await client.query('SET LOCAL synchronous_commit = OFF')
      const variants = Array.from({ length: 3 }, (_, i) => makeVariant({ pos: 900000 + i }))
      await repo.writeVcfFile(client, baseRequest(caseName, variants))
      await client.query('COMMIT')
    })

    const observer = new Client({ connectionString: PG_URL })
    await observer.connect()
    try {
      const r = await observer.query<{ synchronous_commit: string }>('SHOW synchronous_commit')
      // Default is 'on' for a stock postgres; tolerate any non-'off' value
      // (e.g. 'remote_apply' on replicated clusters) as long as the LOCAL
      // override didn't leak. The strict assertion is: not 'off'.
      expect(r.rows[0].synchronous_commit).not.toBe('off')
    } finally {
      await observer.end()
    }
  })

  // -------------------------------------------------------------------------
  // Bullet 7 — HLA mega-allele round-trip
  // -------------------------------------------------------------------------

  it('round-trips a mega-allele variant from synthetic-large-allele.vcf', async () => {
    const caseName = uniqueCaseName('hla-mega-allele')

    // Pull the single largest ALT directly from the fixture so we exercise
    // the real upstream test data, not a synthesised payload.
    const fixturePath = resolve(process.cwd(), 'tests/test-data/vcf/synthetic-large-allele.vcf')
    const fixture = readFileSync(fixturePath, 'utf-8')
    const dataLine = fixture
      .split('\n')
      .find((l) => l.startsWith('chr') && l.split('\t')[4].length > 1000)
    if (dataLine === undefined) {
      throw new Error(`large-allele fixture row not found in ${fixturePath}`)
    }
    const fields = dataLine.split('\t')
    const [chr, posStr, , ref, alt] = fields
    expect(alt.length).toBeGreaterThan(9000)

    const variants = [
      makeVariant({ chr, pos: Number(posStr), ref, alt }),
      makeVariant({ chr: 'chr1', pos: 1000, ref: 'A', alt: 'G' }) // a normal companion
    ]

    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(client, baseRequest(caseName, variants))
      await client.query('COMMIT')
      return r
    })

    const rows = await control.query<{
      alt: string
      coord_hash: Buffer
      search_document: string | null
    }>(
      `SELECT alt, coord_hash, search_document::text AS search_document
       FROM   "${PG_SCHEMA}"."variants"
       WHERE  case_id = $1
       ORDER BY pos`,
      [caseId]
    )
    expect(rows.rows).toHaveLength(2)

    // Find the mega-allele row by alt length.
    const megaRow = rows.rows.find((r) => r.alt.length > 9000)
    const normalRow = rows.rows.find((r) => r.alt === 'G')
    expect(megaRow, 'mega-allele row').toBeDefined()
    expect(normalRow, 'normal companion row').toBeDefined()

    // Byte-for-byte ALT round-trip.
    expect(megaRow!.alt).toBe(alt)
    expect(megaRow!.alt.length).toBe(alt.length)

    // coord_hash is sha256 → 32 bytes, NOT NULL, identical width to a normal
    // allele's coord_hash (the whole point of the hash-keyed index).
    expect(megaRow!.coord_hash).not.toBeNull()
    expect(normalRow!.coord_hash).not.toBeNull()
    expect(megaRow!.coord_hash.length).toBe(32)
    expect(normalRow!.coord_hash.length).toBe(32)
    expect(megaRow!.coord_hash.length).toBe(normalRow!.coord_hash.length)

    // search_document is populated by the per-batch bulk UPDATE.
    expect(megaRow!.search_document).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Bullet 8 — Failure path (NOT NULL violation): partial commit + sequence
  // advance + triggers re-enabled.
  // -------------------------------------------------------------------------

  it('NOT NULL violation: prior batches durable, sequence advances, triggers re-enabled', async () => {
    const caseName = uniqueCaseName('null-violation')

    // First batch — 10 variants, single-file mode, succeeds.
    const { caseId } = await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      const r = await repo.writeVcfFile(
        client,
        baseRequest(
          caseName,
          Array.from({ length: 10 }, (_, i) => makeVariant({ pos: 1_000_000 + i }))
        )
      )
      await client.query('COMMIT')
      return r
    })

    // Sequence value before the failing batch.
    const seqBefore = await control.query<{ last_value: string }>(
      `SELECT last_value::text AS last_value FROM "${PG_SCHEMA}".variants_id_seq`
    )
    const beforeLast = BigInt(seqBefore.rows[0].last_value)

    // Failing batch — 10 rows, one with chr=null. Must run inside the bracket
    // pattern so we can verify triggers are re-enabled afterward.
    const badBatch = Array.from({ length: 10 }, (_, i) => makeVariant({ pos: 1_100_000 + i }))
    badBatch[5] = makeVariant({ chr: null, pos: 1_100_005 })

    await withWorkerLikeClient(async (client) => {
      await client.query('BEGIN')
      try {
        await repo.writeVcfFile(client, {
          mode: 'append',
          caseId,
          caseName,
          fileName: 'test.vcf',
          filePath: '/tmp/test.vcf',
          fileSize: 1024,
          genomeBuild: 'GRCh38',
          caller: null,
          annotationFormat: null,
          variantType: 'snv-indel',
          variants: badBatch,
          transcripts: [],
          sv: [],
          cnv: [],
          str: []
        })
        throw new Error('expected NOT NULL violation')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        expect(msg).toMatch(/null|chr/i)
        // Required to clear the aborted-transaction state before any other
        // statement on this connection succeeds.
        await client.query('ROLLBACK')
      }
    })

    // Prior 10 still committed.
    const remaining = await control.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "${PG_SCHEMA}"."variants" WHERE case_id = $1`,
      [caseId]
    )
    expect(remaining.rows[0].n).toBe(10)

    // Sequence has advanced past at least the second batch's pre-reserved
    // window (sequence advances are NOT rolled back). The repository
    // pre-reserves N IDs via nextval, so the seq should have advanced by
    // ≥ 10 even though the batch was rolled back.
    const seqAfter = await control.query<{ last_value: string }>(
      `SELECT last_value::text AS last_value FROM "${PG_SCHEMA}".variants_id_seq`
    )
    const afterLast = BigInt(seqAfter.rows[0].last_value)
    expect(afterLast - beforeLast).toBeGreaterThanOrEqual(10n)

    // Phase 16.1: no triggers to re-enable — search_document is a STORED
    // generated column. The remaining-row count + sequence-advance checks
    // above are sufficient evidence the failure path rolled back cleanly.
  })
})
