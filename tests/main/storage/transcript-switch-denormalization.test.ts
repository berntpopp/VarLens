/**
 * Transcript-switch denormalization — real-engine behavioral regression (issue #207).
 *
 * Issue #207: switching the selected transcript must update the denormalized
 * transcript columns on the parent `variants` row (transcript, gene_symbol,
 * consequence, func, cdna, aa_change, hpo_sim_score, moi), not just flip
 * `variant_transcripts.is_selected`. The Postgres backend originally missed the
 * parent-row update; PR #214 fixed it inside `PostgresTranscriptsRepository`.
 *
 * Follow-up (D1/D2): `variant_transcripts.consequence` is the IMPACT level
 * (HIGH/MODERATE/LOW/MODIFIER) and `variant_transcripts.func` is the Sequence
 * Ontology term (missense_variant, stop_gained, ...) — same convention as
 * `variants.consequence` / `variants.func`. The denorm writeback originally
 * copied `consequence` but not `func`, so `variants.func` went stale on a
 * transcript switch. `func` must now be copied too, without crossing the two
 * columns.
 *
 * Existing coverage stops short of a real engine:
 *   - postgres-transcripts-repository.test.ts mocks the `pg` client and only
 *     pins the SQL string + params.
 *   - transcripts.test.ts exercises the SQLite repository directly, not the seam.
 *   - storage-session-contract.test.ts pins the *interface* and explicitly defers
 *     cross-backend *behavioral* parity.
 *
 * This test closes that gap: it seeds a real variant + two transcripts, drives the
 * switch through the production `StorageWriteExecutor` seam, and reads the parent
 * `variants` row back from the same engine. Transcripts A and B differ in every
 * denormalized field, so the original no-op bug would fail every assertion.
 *
 * SQLite half: always runs.
 * Postgres half: gated by VARLENS_RUN_POSTGRES_E2E=1 + a running dev container
 *   (make pg-up). Each run uses a unique schema and drops it on cleanup.
 *
 *   make pg-up
 *   VARLENS_RUN_POSTGRES_E2E=1 \
 *   VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55434/varlens_dev \
 *     npx vitest run --project main \
 *     tests/main/storage/transcript-switch-denormalization.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Client } from 'pg'

import { DatabaseService } from '../../../src/main/database'
import type { Variant } from '../../../src/main/database/types'
import { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'
import { createPostgresStorageSession } from '../../../src/main/storage/postgres/createPostgresStorageSession'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import type { StorageSession } from '../../../src/main/storage/session'
import type { TranscriptInsertRow } from '../../../src/shared/types/transcript'

const POSTGRES_E2E = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

/** The eight denormalized transcript columns mirrored onto `variants`. */
interface DenormFields {
  transcript: string | null
  gene_symbol: string | null
  consequence: string | null
  func: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
}

/** Shape of a `variant_transcripts` row for seeding, plus its expected denorm projection. */
interface TranscriptFixture {
  transcript_id: string
  gene_symbol: string
  /** IMPACT level (HIGH/MODERATE/LOW/MODIFIER) — must land in variants.consequence. */
  consequence: string
  /** Sequence Ontology term — must land in variants.func, never in variants.consequence. */
  func: string
  cdna: string
  aa_change: string | null
  hpo_sim_score: number
  moi: string
}

// A and B differ in EVERY denormalized field so a no-op update (the bug) fails loudly.
const TRANSCRIPT_A: TranscriptFixture = {
  transcript_id: 'NM_AAA.1',
  gene_symbol: 'GENEA',
  consequence: 'MODERATE',
  func: 'missense_variant',
  cdna: 'c.1A>G',
  aa_change: 'p.Met1Val',
  hpo_sim_score: 0.1,
  moi: 'AD'
}

const TRANSCRIPT_B: TranscriptFixture = {
  transcript_id: 'NM_BBB.2',
  gene_symbol: 'GENEB',
  consequence: 'HIGH',
  func: 'stop_gained',
  cdna: 'c.2C>T',
  aa_change: 'p.Gln2Ter',
  hpo_sim_score: 0.9,
  moi: 'AR'
}

// VEP-only transcript: not seeded, supplied to transcripts:insertAndSwitch.
const TRANSCRIPT_C: TranscriptInsertRow = {
  transcript_id: 'ENST_CCC.1',
  gene_symbol: 'GENEC',
  consequence: 'HIGH',
  func: 'splice_acceptor_variant',
  cdna: 'c.3-1G>A',
  aa_change: null,
  hpo_sim_score: 0.55,
  moi: 'XL',
  is_selected: 1
}

const LEGACY_TRANSCRIPT: TranscriptFixture = {
  transcript_id: 'NM_LEGACY.1',
  gene_symbol: 'LEGACY',
  consequence: 'stop_gained',
  func: 'stop_gained',
  cdna: 'c.4C>T',
  aa_change: 'p.Gln2Ter',
  hpo_sim_score: 0.4,
  moi: 'AD'
}

function denormOf(t: TranscriptFixture): DenormFields {
  return {
    transcript: t.transcript_id,
    gene_symbol: t.gene_symbol,
    consequence: t.consequence,
    func: t.func,
    cdna: t.cdna,
    aa_change: t.aa_change,
    hpo_sim_score: t.hpo_sim_score,
    moi: t.moi
  }
}

function denormOfInsert(t: TranscriptInsertRow): DenormFields {
  return {
    transcript: t.transcript_id,
    gene_symbol: t.gene_symbol,
    consequence: t.consequence,
    func: t.func,
    cdna: t.cdna,
    aa_change: t.aa_change,
    hpo_sim_score: t.hpo_sim_score,
    moi: t.moi
  }
}

interface BackendHarness {
  session: StorageSession
  /** Insert a fresh case + variant (carrying A's values) + transcripts A (selected) and B. */
  seedVariantWithTranscripts: () => Promise<number>
  /** Add a pre-migration row whose SO term is still stored in consequence. */
  addLegacyTranscript: (variantId: number) => Promise<void>
  readVariantDenorm: (variantId: number) => Promise<DenormFields>
  cleanup: () => Promise<void>
}

interface BackendFixture {
  name: 'sqlite' | 'postgres'
  setup: () => Promise<BackendHarness>
}

function variantSeed(): Omit<Variant, 'id' | 'case_id'> {
  // The variants row starts out carrying transcript A's denormalized values.
  return {
    chr: '17',
    pos: 43094000,
    ref: 'A',
    alt: 'G',
    gene_symbol: TRANSCRIPT_A.gene_symbol,
    omim_mim_number: null,
    consequence: TRANSCRIPT_A.consequence,
    gnomad_af: 0.001,
    cadd: 28,
    clinvar: null,
    gt_num: '0/1',
    func: TRANSCRIPT_A.func,
    qual: 30,
    hpo_sim_score: TRANSCRIPT_A.hpo_sim_score,
    transcript: TRANSCRIPT_A.transcript_id,
    cdna: TRANSCRIPT_A.cdna,
    aa_change: TRANSCRIPT_A.aa_change,
    moi: TRANSCRIPT_A.moi
  }
}

async function setupSqlite(): Promise<BackendHarness> {
  const tempDir = mkdtempSync(join(tmpdir(), 'varlens-transcript-switch-sqlite-'))
  const dbPath = join(tempDir, 'session.db')
  const db = new DatabaseService(dbPath)
  const session = new SqliteStorageSession({ databaseService: db, dbPool: null })

  let seedCounter = 0
  const insertTranscript = db.database.prepare(
    `INSERT INTO variant_transcripts
       (variant_id, transcript_id, gene_symbol, consequence, func, cdna, aa_change,
        hpo_sim_score, moi, is_selected)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  return {
    session,
    seedVariantWithTranscripts: async () => {
      seedCounter += 1
      const caseId = db.cases.createCase(`issue-207-${seedCounter}`, '/issue-207.json', 100)
      db.variants.insertVariantsBatch(caseId, [variantSeed()])
      const variantId = db.variants.getVariants({ case_id: caseId }, 10).data[0].id
      for (const [t, selected] of [
        [TRANSCRIPT_A, 1],
        [TRANSCRIPT_B, 0]
      ] as const) {
        insertTranscript.run(
          variantId,
          t.transcript_id,
          t.gene_symbol,
          t.consequence,
          t.func,
          t.cdna,
          t.aa_change,
          t.hpo_sim_score,
          t.moi,
          selected
        )
      }
      return variantId
    },
    addLegacyTranscript: async (variantId: number) => {
      insertTranscript.run(
        variantId,
        LEGACY_TRANSCRIPT.transcript_id,
        LEGACY_TRANSCRIPT.gene_symbol,
        LEGACY_TRANSCRIPT.consequence,
        null,
        LEGACY_TRANSCRIPT.cdna,
        LEGACY_TRANSCRIPT.aa_change,
        LEGACY_TRANSCRIPT.hpo_sim_score,
        LEGACY_TRANSCRIPT.moi,
        0
      )
    },
    readVariantDenorm: async (variantId: number) => {
      const row = db.database
        .prepare(
          `SELECT transcript, gene_symbol, consequence, func, cdna, aa_change, hpo_sim_score, moi
             FROM variants WHERE id = ?`
        )
        .get(variantId) as DenormFields
      return row
    },
    cleanup: async () => {
      await session.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

async function setupPostgres(): Promise<BackendHarness> {
  const schema = `varlens_test_${Date.now()}_${randomBytes(4).toString('hex')}`

  const provisioner = new Client({ connectionString: PG_URL })
  await provisioner.connect()
  await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
  await provisioner.end()

  const config: PostgresStorageConfig = {
    url: PG_URL,
    schema,
    applicationName: 'varlens-test',
    sslMode: 'disable',
    connectionTimeoutMillis: 5000,
    statementTimeoutMs: 30_000,
    queryTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    idleInTransactionSessionTimeoutMs: 10_000,
    poolMax: 2
  }

  const session = await createPostgresStorageSession(config)

  // Dedicated client for seeding + readback against the same schema.
  const client = new Client({ connectionString: PG_URL })
  await client.connect()

  let seedCounter = 0

  return {
    session,
    seedVariantWithTranscripts: async () => {
      seedCounter += 1
      const caseRes = await client.query(
        `INSERT INTO "${schema}".cases (name, file_path, file_size, variant_count, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`issue-207-${seedCounter}`, '/issue-207.json', 100, 0, Date.now()]
      )
      const caseId = Number(caseRes.rows[0].id)

      const seed = variantSeed()
      const variantRes = await client.query(
        `INSERT INTO "${schema}".variants
           (case_id, chr, pos, ref, alt, gene_symbol, consequence, func,
            hpo_sim_score, transcript, cdna, aa_change, moi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          caseId,
          seed.chr,
          seed.pos,
          seed.ref,
          seed.alt,
          seed.gene_symbol,
          seed.consequence,
          seed.func,
          seed.hpo_sim_score,
          seed.transcript,
          seed.cdna,
          seed.aa_change,
          seed.moi
        ]
      )
      const variantId = Number(variantRes.rows[0].id)

      for (const [t, selected] of [
        [TRANSCRIPT_A, 1],
        [TRANSCRIPT_B, 0]
      ] as const) {
        await client.query(
          `INSERT INTO "${schema}".variant_transcripts
             (variant_id, transcript_id, gene_symbol, consequence, func, cdna, aa_change,
              hpo_sim_score, moi, is_selected)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            variantId,
            t.transcript_id,
            t.gene_symbol,
            t.consequence,
            t.func,
            t.cdna,
            t.aa_change,
            t.hpo_sim_score,
            t.moi,
            selected
          ]
        )
      }
      return variantId
    },
    addLegacyTranscript: async (variantId: number) => {
      await client.query(
        `INSERT INTO "${schema}".variant_transcripts
           (variant_id, transcript_id, gene_symbol, consequence, func, cdna, aa_change,
            hpo_sim_score, moi, is_selected)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          variantId,
          LEGACY_TRANSCRIPT.transcript_id,
          LEGACY_TRANSCRIPT.gene_symbol,
          LEGACY_TRANSCRIPT.consequence,
          null,
          LEGACY_TRANSCRIPT.cdna,
          LEGACY_TRANSCRIPT.aa_change,
          LEGACY_TRANSCRIPT.hpo_sim_score,
          LEGACY_TRANSCRIPT.moi,
          0
        ]
      )
    },
    readVariantDenorm: async (variantId: number) => {
      const res = await client.query(
        `SELECT transcript, gene_symbol, consequence, func, cdna, aa_change, hpo_sim_score, moi
           FROM "${schema}".variants WHERE id = $1`,
        [variantId]
      )
      const r = res.rows[0]
      return {
        transcript: r.transcript,
        gene_symbol: r.gene_symbol,
        consequence: r.consequence,
        func: r.func,
        cdna: r.cdna,
        aa_change: r.aa_change,
        hpo_sim_score: r.hpo_sim_score === null ? null : Number(r.hpo_sim_score),
        moi: r.moi
      }
    },
    cleanup: async () => {
      await client.end()
      await session.close()
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }
}

const fixtures: BackendFixture[] = [
  { name: 'sqlite', setup: setupSqlite },
  ...(POSTGRES_E2E ? [{ name: 'postgres' as const, setup: setupPostgres }] : [])
]

describe.each(fixtures)('transcript-switch denormalization — $name', ({ setup }) => {
  let h: BackendHarness

  beforeAll(async () => {
    h = await setup()
  }, 60_000)

  afterAll(async () => {
    if (h) await h.cleanup()
  }, 60_000)

  it('transcripts:switch updates the parent variants row to the new transcript', async () => {
    const variantId = await h.seedVariantWithTranscripts()

    // Precondition: parent row carries transcript A's values.
    expect(await h.readVariantDenorm(variantId)).toEqual(denormOf(TRANSCRIPT_A))

    await h.session.getWriteExecutor().execute({
      type: 'transcripts:switch',
      params: [variantId, TRANSCRIPT_B.transcript_id]
    })

    expect(await h.readVariantDenorm(variantId)).toEqual(denormOf(TRANSCRIPT_B))
  })

  it('transcripts:insertAndSwitch syncs the parent variants row to a VEP-only transcript', async () => {
    const variantId = await h.seedVariantWithTranscripts()

    await h.session.getWriteExecutor().execute({
      type: 'transcripts:insertAndSwitch',
      params: [variantId, TRANSCRIPT_C]
    })

    expect(await h.readVariantDenorm(variantId)).toEqual(denormOfInsert(TRANSCRIPT_C))
  })

  it('clears stale parent impact when the selected legacy transcript has no recoverable impact', async () => {
    const variantId = await h.seedVariantWithTranscripts()
    await h.addLegacyTranscript(variantId)

    await h.session.getWriteExecutor().execute({
      type: 'transcripts:switch',
      params: [variantId, LEGACY_TRANSCRIPT.transcript_id]
    })

    expect(await h.readVariantDenorm(variantId)).toEqual({
      transcript: LEGACY_TRANSCRIPT.transcript_id,
      gene_symbol: LEGACY_TRANSCRIPT.gene_symbol,
      consequence: null,
      func: LEGACY_TRANSCRIPT.func,
      cdna: LEGACY_TRANSCRIPT.cdna,
      aa_change: LEGACY_TRANSCRIPT.aa_change,
      hpo_sim_score: LEGACY_TRANSCRIPT.hpo_sim_score,
      moi: LEGACY_TRANSCRIPT.moi
    })
  })
})

describe.skipIf(POSTGRES_E2E)('transcript-switch denormalization — postgres half (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(POSTGRES_E2E).toBe(false)
  })
})
