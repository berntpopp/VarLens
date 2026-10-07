/**
 * Sprint A PR-3 C8 + Gate 10 — cohort-summary drift detection.
 *
 * Guards against incremental-vs-full-rebuild drift: a full rebuild() establishes
 * the source-of-truth snapshot, then N incremental no-op shuffles
 * (incrementalRemove immediately followed by incrementalAdd for the same case)
 * must leave cohort_variant_summary byte-identical to that rebuild. The shuffle
 * is a no-op in aggregate, so the post-incremental snapshot must deep-equal the
 * first full-rebuild snapshot — any divergence means the incremental path and
 * the full-rebuild path disagree, which is exactly the class of bug users would
 * hit silently. A trailing second rebuild() is asserted as well to confirm full
 * rebuilds remain deterministic from the unchanged source tables.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import {
  awaitBackgroundRebuild,
  prepareCohortRead,
  readCohortSummaryStatus
} from '../../../src/main/storage/postgres/cohort-read-freshness'
import { lockSummaryForWrite } from '../../../src/main/storage/postgres/cohort-summary-lock'
import { PostgresTranscriptsRepository } from '../../../src/main/storage/postgres/PostgresTranscriptsRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface SeedVariant {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  variantType?: string
  geneSymbol?: string | null
  gtNum?: string | null
}

describe.skipIf(!RUN)('cohort-summary drift detection — Sprint A C8 / Gate 10', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_drift_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.variantType ?? 'snv',
        v.geneSymbol ?? null,
        v.gtNum ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  /**
   * Full deterministic snapshot of cohort_variant_summary. Selects every
   * non-volatile column (the deduped aggregate + derived flags + frequency) and
   * orders by the full natural key so two snapshots are directly comparable.
   * Counts are coerced to numbers because node-pg returns BIGINT as strings.
   */
  async function snapshotSummary(reader: Pick<Client, 'query'> = probe): Promise<unknown[]> {
    const res = await reader.query<{
      chr: string
      pos: string
      end_pos: string | null
      ref: string
      alt: string
      variant_type: string
      genome_build: string
      gene_symbol: string | null
      cdna: string | null
      aa_change: string | null
      consequence: string | null
      func: string | null
      clinvar: string | null
      gnomad_af: number | null
      cadd: number | null
      transcript: string | null
      omim_mim_number: string | null
      carrier_count: string
      het_count: string
      hom_count: string
      variant_key: string
      has_star: boolean
      has_comment: boolean
      acmg_best: string | null
      cohort_frequency: number | null
    }>(
      `SELECT chr, pos, end_pos, ref, alt, variant_type, genome_build,
              gene_symbol, cdna, aa_change, consequence, func, clinvar,
              gnomad_af, cadd, transcript, omim_mim_number,
              carrier_count, het_count, hom_count, variant_key,
              has_star, has_comment, acmg_best, cohort_frequency
         FROM "${schema}".cohort_variant_summary
        ORDER BY genome_build, variant_type, chr, pos, ref, alt`
    )
    return res.rows.map((r) => ({
      chr: r.chr,
      pos: Number(r.pos),
      end_pos: r.end_pos === null ? null : Number(r.end_pos),
      ref: r.ref,
      alt: r.alt,
      variant_type: r.variant_type,
      genome_build: r.genome_build,
      gene_symbol: r.gene_symbol,
      cdna: r.cdna,
      aa_change: r.aa_change,
      consequence: r.consequence,
      func: r.func,
      clinvar: r.clinvar,
      gnomad_af: r.gnomad_af,
      cadd: r.cadd,
      transcript: r.transcript,
      omim_mim_number: r.omim_mim_number,
      carrier_count: Number(r.carrier_count),
      het_count: Number(r.het_count),
      hom_count: Number(r.hom_count),
      variant_key: r.variant_key,
      has_star: r.has_star,
      has_comment: r.has_comment,
      acmg_best: r.acmg_best,
      cohort_frequency: r.cohort_frequency
    }))
  }

  /** What a full rebuild would store in the gene tables; nothing is kept. */
  async function rebuiltGeneTables(): Promise<unknown> {
    return withClient(async (client) => {
      await client.query('BEGIN')
      try {
        await repo.rebuild({ schema, client: client as never })
        return await snapshotGeneTables(client)
      } finally {
        await client.query('ROLLBACK')
      }
    })
  }

  /** The per-gene aggregates maintained alongside the summary (0023). */
  async function snapshotGeneTables(reader: Pick<Client, 'query'> = probe): Promise<unknown> {
    const genes = await reader.query(
      `SELECT gene_symbol, variant_count::int, unique_variant_count::int, affected_case_count::int
         FROM "${schema}".cohort_gene_summary ORDER BY gene_symbol`
    )
    const pairs = await reader.query(
      `SELECT gene_symbol, chr, pos, ref, alt, carrier_count::int
         FROM "${schema}".cohort_gene_variant_summary
        ORDER BY gene_symbol, chr, pos, ref, alt`
    )
    return { genes: genes.rows, pairs: pairs.rows }
  }

  const repo = new PostgresCohortSummaryRepository()

  /** What a full rebuild would store right now; the maintained rows are left untouched. */
  async function rebuiltSummary(): Promise<unknown[]> {
    return withClient(async (client) => {
      await client.query('BEGIN')
      try {
        await repo.rebuild({ schema, client: client as never })
        return await snapshotSummary(client)
      } finally {
        await client.query('ROLLBACK')
      }
    })
  }

  async function inTransaction(fn: (client: Client) => Promise<void>): Promise<void> {
    await withClient(async (client) => {
      await client.query('BEGIN')
      try {
        await fn(client)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })
  }

  async function seedAnnotated(
    caseId: number,
    annotation: Record<string, string | number | null>
  ): Promise<number> {
    const columns = Object.keys(annotation)
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gt_num${columns.map((c) => `, ${c}`).join('')})
         VALUES ($1, '1', 100, 'A', 'T', 'snv', '0/1'${columns.map((_, i) => `, $${i + 2}`).join('')})
         RETURNING id`,
      [caseId, ...Object.values(annotation)]
    )
    return res.rows[0].id
  }

  /** The maintained counter and what a count over the summary / the variants gives (#460). */
  async function uniqueVariants(): Promise<{ stored: number; summary: number; variants: number }> {
    const res = await probe.query<{ stored: number; summary: number; variants: number }>(
      `SELECT (SELECT unique_variant_count::int FROM "${schema}".cohort_summary_state WHERE id = 1) AS stored,
              (SELECT COUNT(*)::int FROM (SELECT 1 FROM "${schema}".cohort_variant_summary
                                           GROUP BY chr, pos, ref, alt) s) AS summary,
              (SELECT COUNT(*)::int FROM (SELECT 1 FROM "${schema}".variants
                                           GROUP BY chr, pos, ref, alt) v) AS variants`
    )
    return res.rows[0]
  }

  async function expectUniqueVariants(expected: number): Promise<void> {
    expect(await uniqueVariants()).toEqual({
      stored: expected,
      summary: expected,
      variants: expected
    })
  }

  it('keeps the unique-variant counter exact through imports, deletions and a rebuild (#460)', async () => {
    const add = (caseId: number): Promise<void> =>
      inTransaction((client) => repo.incrementalAdd({ schema, client: client as never, caseId }))
    // The production path: hide (derived tables, under the lock), purge, drop.
    const lifecycle = new PostgresCaseLifecycleRepository(pool, schema, repo)
    const remove = async (caseId: number): Promise<void> => {
      await lifecycle.deleteCase(caseId)
    }
    await expectUniqueVariants(0)

    // Case A: 1:100 twice in the same case (duplicate rows), and 1:200 both as
    // an SNV and as an SV: three rows of two types, two coordinates.
    const a = await seedCase('uniq-a')
    await seedVariant({ caseId: a, chr: '1', pos: 100, ref: 'A', alt: 'T' })
    await seedVariant({ caseId: a, chr: '1', pos: 100, ref: 'A', alt: 'T' })
    await seedVariant({ caseId: a, chr: '1', pos: 200, ref: 'C', alt: 'G' })
    await seedVariant({ caseId: a, chr: '1', pos: 200, ref: 'C', alt: 'G', variantType: 'sv' })
    await add(a)
    await expectUniqueVariants(2)

    // Case B, another genome build: 1:100 again (a second summary row for a
    // known coordinate) and a new coordinate.
    const b = await seedCase('uniq-b', 'GRCh37')
    await seedVariant({ caseId: b, chr: '1', pos: 100, ref: 'A', alt: 'T' })
    await seedVariant({ caseId: b, chr: '3', pos: 300, ref: 'G', alt: 'A' })
    await add(b)
    await expectUniqueVariants(3)
    const summaryRows = await probe.query(
      `SELECT COUNT(*)::int AS n FROM "${schema}".cohort_variant_summary`
    )
    expect(summaryRows.rows[0].n).toBe(5) // the row count would overstate it

    // Case C shares everything with A: no new coordinate.
    const c = await seedCase('uniq-c')
    await seedVariant({ caseId: c, chr: '1', pos: 100, ref: 'A', alt: 'T' })
    await seedVariant({ caseId: c, chr: '1', pos: 200, ref: 'C', alt: 'G', variantType: 'sv' })
    await add(c)
    await expectUniqueVariants(3)

    // Removing A drops the SNV row of 1:200 but the coordinate stays (SV row of C).
    await remove(a)
    await expectUniqueVariants(3)
    // Removing B drops 3:300 entirely and one of the two rows of 1:100.
    await remove(b)
    await expectUniqueVariants(2)

    // A rebuild recounts; from a deliberately wrong value too.
    await probe.query(`UPDATE "${schema}".cohort_summary_state SET unique_variant_count = 99`)
    await withClient((client) => repo.rebuild({ schema, client: client as never }))
    await expectUniqueVariants(2)

    await remove(c)
    await expectUniqueVariants(0)
  }, 120_000)

  it('a transcript switch never queues behind a busy summary: it commits and the summary is rebuilt later (#461)', async () => {
    const add = (caseId: number): Promise<void> =>
      inTransaction((client) => repo.incrementalAdd({ schema, client: client as never, caseId }))
    const first = await seedCase('busy-a')
    const second = await seedCase('busy-b')
    const hidden = await seedCase('busy-hidden')
    const annotation = { gene_symbol: 'BRCA1', consequence: 'HIGH', func: 'stop_gained' }
    const firstVariant = await seedAnnotated(first, annotation)
    await seedAnnotated(second, annotation)
    const hiddenVariant = await seedAnnotated(hidden, annotation)
    await add(first)
    await add(second)
    await probe.query(
      `UPDATE "${schema}".cases_all SET import_status = 'importing' WHERE id = $1`,
      [hidden]
    )
    const maintainedBefore = await snapshotSummary()
    const transcript = {
      transcript_id: 'ENST00000000009',
      gene_symbol: 'ZZZ9',
      consequence: 'MODIFIER',
      func: 'intron_variant',
      cdna: 'c.9A>T',
      aa_change: null,
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    }
    const isStale = async (): Promise<boolean> =>
      (await readCohortSummaryStatus({ pool, schema })).is_stale

    // Another writer (a publishing import, a rebuild) holds the summary lock.
    const holder = new Client({ connectionString: PG_URL })
    await holder.connect()
    await holder.query('BEGIN')
    await lockSummaryForWrite(holder, schema)
    try {
      const transcripts = new PostgresTranscriptsRepository(pool, schema, {
        summaryLockWaitMs: 300
      })

      // A hidden case has no summary rows: nothing to flag, nothing to wait for.
      await transcripts.insertTranscriptAndSwitch(hiddenVariant, transcript as never)
      expect(await isStale()).toBe(false)

      const started = Date.now()
      await expect(
        transcripts.insertTranscriptAndSwitch(firstVariant, transcript as never)
      ).resolves.toEqual({ success: true })
      expect(Date.now() - started).toBeLessThan(5_000)

      // The user's change is committed although the summary could not be touched …
      const variant = await probe.query(
        `SELECT gene_symbol, consequence, transcript FROM "${schema}".variants WHERE id = $1`,
        [firstVariant]
      )
      expect(variant.rows[0]).toEqual({
        gene_symbol: 'ZZZ9',
        consequence: 'MODIFIER',
        transcript: 'ENST00000000009'
      })
      // … which is left as it was and flagged for a rebuild.
      expect(await snapshotSummary()).toEqual(maintainedBefore)
      expect(await isStale()).toBe(true)
    } finally {
      await holder.query('ROLLBACK')
      await holder.end()
    }

    // The next cohort read reconciles: afterwards maintained == rebuild.
    await prepareCohortRead({ pool, schema })
    await awaitBackgroundRebuild(schema)
    expect(await isStale()).toBe(false)
    expect(await rowAt100()).toMatchObject({ gene_symbol: 'ZZZ9', consequence: 'MODIFIER' })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    expect(await snapshotGeneTables()).toEqual(await rebuiltGeneTables())

    // With the lock free again a switch maintains the summary in place.
    await new PostgresTranscriptsRepository(pool, schema).insertTranscriptAndSwitch(firstVariant, {
      ...transcript,
      transcript_id: 'ENST00000000010',
      gene_symbol: 'AAA1'
    } as never)
    expect(await isStale()).toBe(false)
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
  }, 120_000)

  async function rowAt100(): Promise<Record<string, unknown>> {
    const res = await probe.query(
      `SELECT gene_symbol, consequence, func, clinvar, cadd, transcript, cdna, carrier_count::int
         FROM "${schema}".cohort_variant_summary WHERE chr = '1' AND pos = 100`
    )
    return res.rows[0]
  }

  it('a differing annotation, a transcript switch and a removal keep the maintained summary equal to a rebuild (#461)', async () => {
    const add = (caseId: number): Promise<void> =>
      inTransaction((client) => repo.incrementalAdd({ schema, client: client as never, caseId }))

    // Two carriers of 1:100:A:T that agree, plus an unrelated coordinate.
    const first = await seedCase('rep-a')
    const second = await seedCase('rep-b')
    const agreed = {
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      func: 'stop_gained',
      clinvar: 'Pathogenic',
      cadd: 32.5
    }
    await seedAnnotated(first, agreed)
    await seedAnnotated(second, agreed)
    await seedVariant({ caseId: second, chr: '2', pos: 5, ref: 'C', alt: 'G', geneSymbol: 'TP53' })
    await add(first)
    await add(second)
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())

    // 1. A third carrier annotated differently: every column takes the larger
    //    value, NULLs are ignored, text compares bytewise ('a…' > 'Z…' > 'B…').
    const third = await seedCase('rep-c')
    const thirdVariant = await seedAnnotated(third, {
      gene_symbol: 'BRCA1-AS1',
      consequence: 'MODIFIER',
      func: 'intron_variant',
      clinvar: null,
      cadd: 40,
      cdna: 'c.1A>T'
    })
    const fourth = await seedCase('rep-d')
    await seedAnnotated(fourth, { gene_symbol: 'aBRCA', cdna: 'Z.9', cadd: 1 })
    await add(third)
    await add(fourth)
    expect(await rowAt100()).toMatchObject({
      gene_symbol: 'aBRCA',
      consequence: 'MODIFIER',
      func: 'stop_gained',
      clinvar: 'Pathogenic',
      cadd: 40,
      cdna: 'c.1A>T',
      carrier_count: 4
    })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())

    // 2. Transcript switch on the third carrier: it stops holding the
    //    consequence and cdna maxima, which fall back to the other carriers.
    const transcripts = new PostgresTranscriptsRepository(pool, schema)
    await transcripts.insertTranscriptAndSwitch(thirdVariant, {
      transcript_id: 'ENST00000000001',
      gene_symbol: 'AAAS',
      consequence: 'HIGH',
      func: 'frameshift_variant',
      cdna: 'c.1del',
      aa_change: 'p.M1fs',
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    } as never)
    expect(await rowAt100()).toMatchObject({
      gene_symbol: 'aBRCA',
      consequence: 'HIGH',
      func: 'stop_gained',
      transcript: 'ENST00000000001',
      cdna: 'c.1del',
      cadd: 40
    })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    expect(await snapshotGeneTables()).toEqual(await rebuiltGeneTables())

    // 3. Removing carriers that hold maxima: the row falls back to what the
    //    remaining carriers supply; removing one that holds none changes nothing.
    const remove = (caseId: number): Promise<void> =>
      inTransaction(async (client) => {
        await repo.incrementalRemove({ schema, client: client as never, caseId })
        await client.query(`DELETE FROM "${schema}".cases WHERE id = $1`, [caseId])
      })
    await new PostgresCaseLifecycleRepository(pool, schema, repo).deleteCase(third)
    expect(await rowAt100()).toMatchObject({
      gene_symbol: 'aBRCA',
      cadd: 32.5,
      transcript: null,
      cdna: 'Z.9',
      carrier_count: 3
    })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    await remove(fourth)
    expect(await rowAt100()).toMatchObject({ gene_symbol: 'BRCA1', cdna: null, carrier_count: 2 })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    await remove(first)
    expect(await rowAt100()).toMatchObject({ ...agreed, carrier_count: 1 })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    expect(await snapshotGeneTables()).toEqual(await rebuiltGeneTables())
  }, 120_000)

  it('rebuild + N incremental ops + rebuild = byte-identical', async () => {
    // 1. Seed N cases + variants. Mix of shared/distinct coordinates, het/hom
    //    genotypes, and an annotated variant so the snapshot exercises every
    //    derived column (counts, flags, acmg_best, frequency).
    const N = 4
    const caseIds: number[] = []
    const buildByCase = new Map<number, string>()
    for (let i = 0; i < N; i++) {
      const build = i % 2 === 0 ? 'GRCh38' : 'GRCh37'
      const id = await seedCase(`drift-case-${i}`, build)
      caseIds.push(id)
      buildByCase.set(id, build)
    }

    // Shared GRCh38 coordinate carried by the two GRCh38 cases (indices 0, 2).
    await seedVariant({
      caseId: caseIds[0],
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gtNum: '0/1',
      geneSymbol: 'BRCA1'
    })
    await seedVariant({
      caseId: caseIds[2],
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gtNum: '1/1',
      geneSymbol: 'BRCA1'
    })
    // Distinct per-case coordinates on each case (covers single-carrier rows).
    for (let i = 0; i < N; i++) {
      await seedVariant({
        caseId: caseIds[i],
        chr: '2',
        pos: 200 + i,
        ref: 'C',
        alt: 'G',
        gtNum: i % 2 === 0 ? '0/1' : '1/1',
        geneSymbol: 'TP53'
      })
    }
    // A duplicate per-case row (dedup must collapse it to one carrier).
    await seedVariant({
      caseId: caseIds[0],
      chr: '3',
      pos: 300,
      ref: 'G',
      alt: 'A',
      gtNum: '0/1'
    })
    await seedVariant({
      caseId: caseIds[0],
      chr: '3',
      pos: 300,
      ref: 'G',
      alt: 'A',
      gtNum: '0/1'
    })
    // Global annotation so has_star / has_comment / acmg_best are non-default.
    await probe.query(
      `INSERT INTO "${schema}".variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ('1', 100, 'A', 'T', 'noted', 1, 'Pathogenic', $1, $1)`,
      [now]
    )

    // 2. Full rebuild, then snapshot.
    await withClient((client) => repo.rebuild({ schema, client: client as never }))
    const firstSnapshot = await snapshotSummary()
    const firstGeneSnapshot = await snapshotGeneTables()
    expect((firstGeneSnapshot as { genes: unknown[] }).genes.length).toBeGreaterThan(0)
    // Sanity: the seeding actually produced rows, otherwise the equality below
    // would be a vacuous pass.
    expect(firstSnapshot.length).toBeGreaterThan(0)

    // 3. For each case: incrementalRemove then incrementalAdd (a no-op shuffle).
    //    Scope each op to the case's own genome_build so the frequency recompute
    //    matches the per-build behaviour the production callers use. Run the whole
    //    shuffle inside ONE explicit transaction on a single client, mirroring the
    //    production cohort-summary maintenance boundary (rebuild + incremental ops
    //    execute as a single atomic unit) so a transaction-isolation regression
    //    is exercised by this path too.
    await withClient(async (client) => {
      await client.query('BEGIN')
      try {
        for (const caseId of caseIds) {
          const genomeBuild = buildByCase.get(caseId)!
          await repo.incrementalRemove({
            schema,
            client: client as never,
            caseId,
            genomeBuild
          })
          await repo.incrementalAdd({
            schema,
            client: client as never,
            caseId,
            genomeBuild
          })
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    })

    // 4. Snapshot AFTER the incremental shuffle but BEFORE any further rebuild.
    //    This is the load-bearing assertion: it compares the incremental-only
    //    state directly against the full-rebuild source of truth. Because the
    //    shuffle is a no-op in aggregate, the incremental path must reproduce the
    //    rebuild exactly. Any drift (wrong counter delta, stale flag, missed
    //    frequency recompute, leftover zero-carrier row) shows up here — a later
    //    full rebuild would silently correct it, so it must be checked first.
    const postIncrementalSnapshot = await snapshotSummary()
    expect(await snapshotGeneTables()).toEqual(firstGeneSnapshot)
    expect(postIncrementalSnapshot).toEqual(firstSnapshot)

    // 5. Secondary determinism check: a second full rebuild from the unchanged
    //    source tables must still match the first rebuild. This guards the
    //    rebuild path's own reproducibility independent of the incremental path.
    await withClient((client) => repo.rebuild({ schema, client: client as never }))
    const secondSnapshot = await snapshotSummary()
    expect(await snapshotGeneTables()).toEqual(firstGeneSnapshot)
    expect(secondSnapshot).toEqual(firstSnapshot)
  }, 120_000)
})

describe.skipIf(RUN)('cohort-summary drift detection — Sprint A C8 / Gate 10 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
