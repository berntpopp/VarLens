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
import { annotationSeverityRanks } from '../../../src/shared/config/severity.config'
import { CohortSummaryRefreshingError } from '../../../src/shared/errors/cohort-summary-refreshing'
import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import {
  awaitBackgroundRebuild,
  prepareCohortRead,
  readCohortSummaryStatus
} from '../../../src/main/storage/postgres/cohort-read-freshness'
import { lockSummaryForWrite } from '../../../src/main/storage/postgres/cohort-summary-lock'
import { PostgresOverviewRepository } from '../../../src/main/storage/postgres/PostgresOverviewRepository'
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
      impact_rank: number
      clinvar_rank: number
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
              gnomad_af, cadd, transcript, omim_mim_number, impact_rank, clinvar_rank,
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
      impact_rank: r.impact_rank,
      clinvar_rank: r.clinvar_rank,
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

  /** A carrier of 1:100:A:T, with the ranks the import pipeline stores (#469). */
  async function seedAnnotated(
    caseId: number,
    annotation: Record<string, string | number | null>
  ): Promise<number> {
    const row = { ...annotation, ...annotationSeverityRanks(annotation) }
    const columns = Object.keys(row)
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gt_num${columns.map((c) => `, ${c}`).join('')})
         VALUES ($1, '1', 100, 'A', 'T', 'snv', '0/1'${columns.map((_, i) => `, $${i + 2}`).join('')})
         RETURNING id`,
      [caseId, ...Object.values(row)]
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
    // LOW carriers, so the switched (HIGH) row is the one the rebuild must show (#469).
    const annotation = { gene_symbol: 'BRCA1', consequence: 'LOW', func: 'synonymous_variant' }
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
      consequence: 'HIGH',
      func: 'stop_gained',
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
        consequence: 'HIGH',
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
    expect(await rowAt100()).toMatchObject({ gene_symbol: 'ZZZ9', consequence: 'HIGH' })
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

  it('a failed publication leaves the counter behind but flagged, and the rebuild recounts it (#460)', async () => {
    const first = await seedCase('fail-a')
    await seedVariant({ caseId: first, chr: '1', pos: 100, ref: 'A', alt: 'T' })
    await inTransaction((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId: first })
    )
    await expectUniqueVariants(1)

    // The import worker's fallback: the summary update of a second case fails
    // inside its savepoint, the case is published anyway and the summary is
    // marked stale in the same transaction.
    const second = await seedCase('fail-b')
    await seedVariant({ caseId: second, chr: '2', pos: 200, ref: 'C', alt: 'G' })
    await seedVariant({ caseId: second, chr: '3', pos: 300, ref: 'G', alt: 'A' })
    await inTransaction(async (client) => {
      await client.query('SAVEPOINT cohort_summary')
      await repo.incrementalAdd({ schema, client: client as never, caseId: second })
      await client.query('ROLLBACK TO SAVEPOINT cohort_summary')
      await repo.markStale({
        schema,
        client: client as never,
        reason: `post_import_summary_failed_case_${second}`
      })
    })

    // Not exact now (the rolled-back statement took its increment with it) …
    expect(await uniqueVariants()).toEqual({ stored: 1, summary: 1, variants: 3 })
    // … and never presented as exact: the summary says it is stale.
    expect((await readCohortSummaryStatus({ pool, schema })).is_stale).toBe(true)

    await prepareCohortRead({ pool, schema })
    await awaitBackgroundRebuild(schema)
    await expectUniqueVariants(3)
    expect((await readCohortSummaryStatus({ pool, schema })).is_stale).toBe(false)
  }, 120_000)

  it('the overview tile is exact without a counter row, and flagged while the summary is stale (#460)', async () => {
    const caseId = await seedCase('tile-a')
    await seedVariant({ caseId, chr: '1', pos: 100, ref: 'A', alt: 'T' })
    await seedVariant({ caseId, chr: '1', pos: 100, ref: 'A', alt: 'T', variantType: 'sv' })
    await seedVariant({ caseId, chr: '2', pos: 200, ref: 'C', alt: 'G' })
    await inTransaction((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId })
    )
    const overview = new PostgresOverviewRepository(pool, schema)
    const current = await overview.getOverview()
    expect(current.summary.unique_variants).toBe(2)
    expect(current.warnings).toBeUndefined()

    // A rebuild request (a transcript switch that could not get the lock)
    // marks the tiles; the figure is not passed off as exact.
    await probe.query(
      `INSERT INTO "${schema}".cohort_summary_rebuild_requests (reason) VALUES ('test')`
    )
    const holder = new Client({ connectionString: PG_URL })
    await holder.connect()
    await holder.query('BEGIN')
    await lockSummaryForWrite(holder, schema)
    try {
      expect((await overview.getOverview()).warnings).toEqual({ staleSummary: true })
    } finally {
      await holder.query('ROLLBACK')
      await holder.end()
    }
    await awaitBackgroundRebuild(schema)
    expect((await overview.getOverview()).warnings).toBeUndefined()

    // No state row at all: the exact count, not 0, and no failure.
    await probe.query(`DELETE FROM "${schema}".cohort_summary_state`)
    const withoutRow = await overview.getOverview()
    expect(withoutRow.summary.unique_variants).toBe(2)
  }, 120_000)

  async function rowAt100(): Promise<Record<string, unknown>> {
    const res = await probe.query(
      `SELECT gene_symbol, consequence, func, clinvar, cadd, transcript, cdna, carrier_count::int
         FROM "${schema}".cohort_variant_summary WHERE chr = '1' AND pos = 100`
    )
    return res.rows[0]
  }

  it('the most severe carrier row represents a variant through add, transcript switch and removal (#469, #461)', async () => {
    const add = (caseId: number): Promise<void> =>
      inTransaction((client) => repo.incrementalAdd({ schema, client: client as never, caseId }))
    const expectExact = async (): Promise<void> =>
      expect(await snapshotSummary()).toEqual(await rebuiltSummary())

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
    await expectExact()

    // 1. A carrier annotated MODIFIER (the issue: HIGH, HIGH, MODIFIER). The old
    //    rule, a bytewise MAX() per column, stored consequence = 'MODIFIER' with
    //    func = 'stop_gained' and gene 'BRCA1-AS1': no carrier's transcript, and
    //    hidden from the filter impact = HIGH. Now the transcript-level columns
    //    stay; only CADD, a fact of the variant, takes the higher value.
    const agreedTranscript = {
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      func: 'stop_gained',
      cdna: null,
      transcript: null
    }
    const third = await seedCase('rep-c')
    const thirdVariant = await seedAnnotated(third, {
      gene_symbol: 'BRCA1-AS1',
      consequence: 'MODIFIER',
      func: 'intron_variant',
      clinvar: null,
      cadd: 40,
      cdna: 'c.1A>T'
    })
    await add(third)
    expect(await rowAt100()).toMatchObject({
      ...agreedTranscript,
      clinvar: 'Pathogenic',
      cadd: 40,
      carrier_count: 3
    })
    const cohort = new PostgresCohortRepository(pool, schema)
    expect(
      (await cohort.queryVariants({ consequences: ['HIGH'] })).data.map((v) => v.variant_key)
    ).toEqual(['1:100:A:T'])
    await expectExact()

    // 2. A carrier that ties on impact: the tie-break is bytewise
    //    ('a…' > 'B…', unlike a linguistic collation) and takes the whole
    //    transcript row (its cdna); its lower CADD does not replace the fact.
    const fourth = await seedCase('rep-d')
    const tied = { ...agreed, gene_symbol: 'aBRCA', cdna: 'Z.9', cadd: 1 }
    const tiedTranscript = { ...agreedTranscript, gene_symbol: 'aBRCA', cdna: 'Z.9' }
    const fourthVariant = await seedAnnotated(fourth, tied)
    await add(fourth)
    expect(await rowAt100()).toMatchObject({ ...tiedTranscript, cadd: 40, carrier_count: 4 })
    await expectExact()

    // 3. Transcript switches. The MODIFIER carrier becomes HIGH frameshift and
    //    loses the tie-break on func ...
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
    expect(await rowAt100()).toMatchObject({ ...tiedTranscript, cadd: 40, carrier_count: 4 })
    await expectExact()
    //    ... and the carrier that supplies the transcript drops to MODERATE: the
    //    row goes back to the carriers that agree.
    await transcripts.insertTranscriptAndSwitch(fourthVariant, {
      transcript_id: 'ENST00000000004',
      gene_symbol: 'MMM',
      consequence: 'MODERATE',
      func: 'missense_variant',
      cdna: 'c.4A>C',
      aa_change: 'p.K2T',
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    } as never)
    expect(await rowAt100()).toMatchObject({ ...agreedTranscript, cadd: 40 })
    await expectExact()
    expect(await snapshotGeneTables()).toEqual(await rebuiltGeneTables())

    // 4. Removal. A carrier whose row another carrier also has changes nothing;
    //    the last such carrier hands the transcript to the next most severe row.
    const remove = (caseId: number): Promise<void> =>
      inTransaction(async (client) => {
        await repo.incrementalRemove({ schema, client: client as never, caseId })
        await client.query(`DELETE FROM "${schema}".cases WHERE id = $1`, [caseId])
      })
    await remove(first)
    expect(await rowAt100()).toMatchObject({ ...agreedTranscript, cadd: 40, carrier_count: 3 })
    await expectExact()
    await new PostgresCaseLifecycleRepository(pool, schema, repo).deleteCase(second)
    expect(await rowAt100()).toMatchObject({
      gene_symbol: 'AAAS',
      consequence: 'HIGH',
      func: 'frameshift_variant',
      cdna: 'c.1del',
      transcript: 'ENST00000000001',
      // Facts of the variant, whoever supplies the transcript: the remaining
      // MODERATE carrier is still ClinVar Pathogenic.
      clinvar: 'Pathogenic',
      cadd: 40,
      carrier_count: 2
    })
    await expectExact()
    await remove(third)
    expect(await rowAt100()).toMatchObject({
      gene_symbol: 'MMM',
      consequence: 'MODERATE',
      func: 'missense_variant',
      clinvar: 'Pathogenic',
      cadd: 1,
      transcript: 'ENST00000000004',
      carrier_count: 1
    })
    await expectExact()
    expect(await snapshotGeneTables()).toEqual(await rebuiltGeneTables())
  }, 120_000)

  it('a ClinVar value of another carrier is not lost behind the chosen transcript (#469 review)', async () => {
    const add = (caseId: number): Promise<void> =>
      inTransaction((client) => repo.incrementalAdd({ schema, client: client as never, caseId }))
    // A is MODERATE and Pathogenic, B is HIGH on another transcript without a
    // ClinVar value, C has the gnomAD frequency the others lack.
    const a = await seedCase('fact-a')
    await seedAnnotated(a, {
      gene_symbol: 'GENEA',
      consequence: 'MODERATE',
      func: 'missense_variant',
      clinvar: 'Pathogenic'
    })
    const b = await seedCase('fact-b')
    await seedAnnotated(b, { gene_symbol: 'GENEB', consequence: 'HIGH', func: 'stop_gained' })
    const c = await seedCase('fact-c')
    await seedAnnotated(c, { gene_symbol: 'GENEC', consequence: 'LOW', gnomad_af: 0.5 })
    for (const caseId of [a, b, c]) await add(caseId)

    const expected = {
      gene_symbol: 'GENEB',
      consequence: 'HIGH',
      func: 'stop_gained',
      clinvar: 'Pathogenic',
      carrier_count: 3
    }
    expect(await rowAt100()).toMatchObject(expected)
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    const cohort = new PostgresCohortRepository(pool, schema)
    for (const filter of [{ clinvars: ['Pathogenic'] }, { consequences: ['HIGH'] }]) {
      const page = await cohort.queryVariants(filter)
      expect(page.data).toEqual([
        expect.objectContaining({ variant_key: '1:100:A:T', gnomad_af: 0.5, clinvar: 'Pathogenic' })
      ])
    }

    // Removing A takes the ClinVar value with it; removing C the frequency.
    const remove = (caseId: number): Promise<void> =>
      inTransaction(async (client) => {
        await repo.incrementalRemove({ schema, client: client as never, caseId })
        await client.query(`DELETE FROM "${schema}".cases WHERE id = $1`, [caseId])
      })
    await remove(a)
    expect(await rowAt100()).toMatchObject({ ...expected, clinvar: null, carrier_count: 2 })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    await remove(c)
    expect((await cohort.queryVariants({})).data).toEqual([
      expect.objectContaining({ gene_symbol: 'GENEB', gnomad_af: null })
    ])
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
  }, 120_000)

  it('ClinVar significance decides between carriers of equal impact (#469)', async () => {
    const add = (caseId: number): Promise<void> =>
      inTransaction((client) => repo.incrementalAdd({ schema, client: client as never, caseId }))
    const carrier = { gene_symbol: 'GENE', consequence: 'MODERATE', func: 'missense_variant' }

    // Bytewise, 'Uncertain_significance' and 'not_provided' sort above 'Pathogenic/…'.
    const uncertain = await seedCase('clin-a')
    await seedAnnotated(uncertain, { ...carrier, clinvar: 'Uncertain_significance', cadd: 9 })
    const pathogenic = await seedCase('clin-b')
    await seedAnnotated(pathogenic, {
      ...carrier,
      clinvar: 'Pathogenic/Likely_pathogenic',
      cadd: 3
    })
    const unprovided = await seedCase('clin-c')
    await seedAnnotated(unprovided, { ...carrier, clinvar: 'not_provided', cadd: 30 })
    for (const caseId of [uncertain, pathogenic, unprovided]) await add(caseId)

    expect(await rowAt100()).toMatchObject({
      clinvar: 'Pathogenic/Likely_pathogenic',
      cadd: 30, // the highest any carrier has
      carrier_count: 3
    })
    expect(await snapshotSummary()).toEqual(await rebuiltSummary())
    const cohort = new PostgresCohortRepository(pool, schema)
    const filtered = await cohort.queryVariants({ clinvars: ['Pathogenic/Likely_pathogenic'] })
    expect(filtered.data.map((v) => v.variant_key)).toEqual(['1:100:A:T'])
  }, 120_000)

  it('page, extension-filtered page and export show the same representative row (#469)', async () => {
    // One SV carried by two cases that annotate it differently, each with an
    // extension row. The extension filter and the export used to aggregate the
    // carriers live (MAX per text column, coordinate-only grouping).
    const carriers = [
      { name: 'ext-a', consequence: 'HIGH', gene: 'BRCA1', gnomad: 0.2, support: 12 },
      { name: 'ext-b', consequence: 'MODIFIER', gene: 'ZZZ', gnomad: 0.01, support: 3 }
    ]
    for (const carrier of carriers) {
      const caseId = await seedCase(carrier.name)
      const variant = await probe.query<{ id: number }>(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, end_pos, ref, alt, variant_type, gt_num, gene_symbol, consequence,
            gnomad_af, impact_rank, clinvar_rank)
         VALUES ($1, '7', 1000, 5000, 'N', '<DEL>', 'sv', '0/1', $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          caseId,
          carrier.gene,
          carrier.consequence,
          carrier.gnomad,
          ...Object.values(annotationSeverityRanks({ consequence: carrier.consequence }))
        ]
      )
      await probe.query(
        `INSERT INTO "${schema}".variant_sv (variant_id, support) VALUES ($1, $2)`,
        [variant.rows[0].id, carrier.support]
      )
      await inTransaction((client) =>
        repo.incrementalAdd({ schema, client: client as never, caseId })
      )
    }
    const cohort = new PostgresCohortRepository(pool, schema)
    const representative = {
      variant_key: '7:1000:N:<DEL>',
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      gnomad_af: 0.01, // the lowest frequency any carrier has
      carrier_count: 2
    }

    const page = await cohort.queryVariants({})
    expect(page.data).toEqual([expect.objectContaining(representative)])

    // Only the MODIFIER carrier has support < 5: the variant matches through
    // it, and is still shown, and counted, as the cohort row.
    const filtered = await cohort.queryVariants({
      column_filters: { 'sv.support': { operator: '<', value: 5 } }
    })
    expect(filtered.data).toEqual(page.data)
    expect(filtered.total_count).toBe(1)
    const none = await cohort.queryVariants({
      column_filters: { 'sv.support': { operator: '>', value: 100 } }
    })
    expect(none.data).toEqual([])

    for (const params of [{}, { column_filters: { 'sv.support': { operator: '<', value: 5 } } }]) {
      const exported: Array<Record<string, unknown>> = []
      for await (const row of cohort.streamCohortRows(params as never)) exported.push(row)
      expect(exported).toEqual([
        expect.objectContaining({ ...representative, total_cases: '2', cohort_frequency: 1 })
      ])
    }
    // The annotation filter applies to the representative on every path.
    const modifier = { consequences: ['MODIFIER'] }
    expect((await cohort.queryVariants(modifier)).data).toEqual([])
    const exportedModifier: unknown[] = []
    for await (const row of cohort.streamCohortRows(modifier)) exportedModifier.push(row)
    expect(exportedModifier).toEqual([])
  }, 120_000)

  it('an extension filter stays inside the genome build of the summary row (#469 review)', async () => {
    // One coordinate carried on GRCh38 (support 20) and on GRCh37 (support 2):
    // two summary rows. The carrier probe used to match on the coordinate only.
    for (const [name, build, support] of [
      ['build-38', 'GRCh38', 20],
      ['build-37', 'GRCh37', 2]
    ] as const) {
      const caseId = await seedCase(name, build)
      const variantId = await seedVariant({
        caseId,
        chr: '7',
        pos: 1000,
        ref: 'N',
        alt: '<DEL>',
        variantType: 'sv',
        geneSymbol: name,
        gtNum: '0/1'
      })
      await probe.query(
        `INSERT INTO "${schema}".variant_sv (variant_id, support) VALUES ($1, $2)`,
        [variantId, support]
      )
      await inTransaction((client) =>
        repo.incrementalAdd({ schema, client: client as never, caseId })
      )
    }
    const cohort = new PostgresCohortRepository(pool, schema)
    const genes = async (operator: '>' | '<', value: number): Promise<Array<string | null>> =>
      (await cohort.queryVariants({ column_filters: { 'sv.support': { operator, value } } })).data
        .map((variant) => variant.gene_symbol)
        .sort()

    expect((await cohort.queryVariants({})).data).toHaveLength(2)
    expect(await genes('>', 10)).toEqual(['build-38'])
    expect(await genes('<', 10)).toEqual(['build-37'])
    expect(await genes('>', 100)).toEqual([])
  }, 120_000)

  it('a rebuild in many small chunks gives the rows of a rebuild in one per chromosome (#469 review)', async () => {
    // Variants on several chromosomes and positions, shared and not, two builds.
    const cases = [
      await seedCase('chunk-a'),
      await seedCase('chunk-b'),
      await seedCase('c37', 'GRCh37')
    ]
    for (const [index, caseId] of cases.entries()) {
      for (const chr of ['1', '2', 'X', 'chrUn_KI270742v1']) {
        for (const pos of [10, 20_000, 3_000_000 + index, 250_000_000]) {
          await seedVariant({
            caseId,
            chr,
            pos,
            ref: 'A',
            alt: 'T',
            geneSymbol: `G${chr}`,
            gtNum: '0/1'
          })
        }
      }
    }
    await probe.query(`UPDATE "${schema}".cases_all SET variant_count = 16`)
    const rebuiltWith = (rowsPerChunk?: number): Promise<unknown[]> =>
      withClient(async (client) => {
        await client.query('BEGIN')
        try {
          const statements: string[] = []
          const query = client.query.bind(client)
          const counting = {
            query: (text: string, values?: unknown[]) => {
              if (/INSERT INTO "[^"]+"\."cohort_variant_summary"/.test(text)) statements.push(text)
              return query(text, values as never)
            }
          }
          await repo.rebuild({ schema, client: counting as never, rowsPerChunk })
          const rows = await snapshotSummary(client)
          return [statements.length, rows]
        } finally {
          await client.query('ROLLBACK')
        }
      })

    const [oneStatements, oneRows] = await rebuiltWith()
    const [manyStatements, manyRows] = await rebuiltWith(1)
    expect(oneStatements).toBe(4) // one per chromosome
    expect(manyStatements).toBeGreaterThan(40)
    // Per chromosome: three shared positions on two builds, three private ones.
    expect(oneRows as unknown[]).toHaveLength(4 * (3 * 2 + 3))
    expect(manyRows).toEqual(oneRows)
  }, 120_000)

  it('an export never reads a stale summary: it waits for the rebuild, or fails typed (#469 review)', async () => {
    const caseId = await seedCase('export-a')
    await seedAnnotated(caseId, { gene_symbol: 'FRESH', consequence: 'HIGH' })
    await inTransaction((client) =>
      repo.incrementalAdd({ schema, client: client as never, caseId })
    )
    // The summary holds an outdated value and is flagged stale, as after
    // migration 0025; the cohort is "large", so a read does not rebuild inline.
    await probe.query(`UPDATE "${schema}".cohort_variant_summary SET gene_symbol = 'OUTDATED'`)
    await inTransaction((client) =>
      repo.markStale({ schema, client: client as never, reason: 'test_export_while_stale' })
    )
    const previous = process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
    process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES = '0'
    const cohort = new PostgresCohortRepository(pool, schema)
    const exported = async (refreshWaitMs: number): Promise<Array<Record<string, unknown>>> => {
      const rows: Array<Record<string, unknown>> = []
      for await (const row of cohort.streamCohortRows({}, { refreshWaitMs })) rows.push(row)
      return rows
    }
    // Somebody holds the summary write lock, so the background rebuild waits.
    const holder = new Client({ connectionString: PG_URL })
    await holder.connect()
    await holder.query('BEGIN')
    await lockSummaryForWrite(holder, schema)
    try {
      // The page is served the stale rows, with the hint ...
      const page = await cohort.queryVariantsWithStaleness({})
      expect(page.warnings).toEqual({ staleSummary: true })
      expect(page.data[0].gene_symbol).toBe('OUTDATED')
      // ... the export is not written.
      const failure = await exported(300).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(CohortSummaryRefreshingError)
      expect(failure).toMatchObject({ code: 'CONFLICT' })
    } finally {
      await holder.query('ROLLBACK')
      await holder.end()
    }
    try {
      // With the lock free the export waits for the rebuild and gets current rows.
      expect((await exported(30_000)).map((row) => row.gene_symbol)).toEqual(['FRESH'])
      expect((await readCohortSummaryStatus({ pool, schema })).is_stale).toBe(false)
    } finally {
      await awaitBackgroundRebuild(schema)
      if (previous === undefined) delete process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
      else process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES = previous
    }
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
