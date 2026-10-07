/**
 * Real-PostgreSQL schedules for the import recovery fence (plan item C1).
 *
 * A batch coordinator owns the workspace import lock; its workers check that
 * lease only when they start. If the coordinator's connection is lost, a new
 * owner can take the lock and run interrupted-import recovery while an old
 * worker is still writing. Every schedule here is forced with explicit
 * connections and barriers (a gated row stream on the worker side, a paused
 * statement on the recovery side), never with sleeps.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectFormat } from '../../../src/main/import/format-detection'
import type { VcfMappedVariant } from '../../../src/main/import/vcf/types'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import {
  openImportLease,
  type ImportLease,
  type ImportLeaseClient
} from '../../../src/main/storage/postgres/postgres-import-lease'
import { PostgresVcfImportRepository } from '../../../src/main/storage/postgres/PostgresVcfImportRepository'
import { createMapperPipeline } from '../../../src/main/workers/import-pipeline'
import {
  runImport,
  streamMappedVcfRows,
  type RunImportDeps
} from '../../../src/main/workers/postgres-import-worker'
import type {
  PostgresImportWorkerOutboundMessage,
  PostgresImportWorkerStartMessage
} from '../../../src/shared/types/postgres-import-worker'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const VCF = resolve(__dirname, '../../test-data/vcf/trio-region.vep.vcf.gz')
/** Rows per import: enough for several one-row batches, small enough to stay fast. */
const ROWS = 12

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

interface Gate {
  reached: Deferred
  resume: Deferred
}

function gate(): Gate {
  return { reached: deferred(), resume: deferred() }
}

/**
 * The first `ROWS` rows of a mapped stream. With one row per batch, every
 * yielded row is committed before the generator is asked for the next one, so
 * pausing before row `n` means exactly `n` rows are committed, and pausing at
 * `'end'` means all rows are committed and publication has not started.
 */
async function* gatedRows(
  source: AsyncIterable<VcfMappedVariant>,
  pauseBefore: number | 'end' | null,
  barrier: Gate | null
): AsyncGenerator<VcfMappedVariant> {
  let yielded = 0
  for await (const row of source) {
    if (yielded === ROWS) break
    if (pauseBefore === yielded && barrier !== null) {
      barrier.reached.resolve()
      await barrier.resume.promise
    }
    yield row
    yielded += 1
  }
  if (pauseBefore === 'end' && barrier !== null) {
    barrier.reached.resolve()
    await barrier.resume.promise
  }
}

describe.skipIf(!RUN)('import recovery fence — schedules on a real instance', () => {
  let schema: string
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_fence_${Date.now()}_${randomBytes(4).toString('hex')}`
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA "${schema}"`)
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    await pool.end()
  }, 60_000)

  afterEach(async () => {
    if (!probe) return
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
  }, 60_000)

  function startWorker(
    caseName: string,
    lease: ImportLease | undefined,
    pauseBefore: number | 'end' | null = null,
    barrier: Gate | null = null,
    onClient: (client: Client) => void = () => undefined
  ): Promise<PostgresImportWorkerOutboundMessage[]> {
    const messages: PostgresImportWorkerOutboundMessage[] = []
    const deps: RunImportDeps = {
      createClient: (config) => {
        const client = new Client(config)
        onClient(client)
        return client
      },
      detectFormat,
      createMapperPipeline,
      statFile: (path) => ({ size: statSync(path).size }),
      createVcfMappedStream: async (filePath, options) =>
        gatedRows(
          streamMappedVcfRows(filePath, options.selectedSample, options.filters, options.onSkip),
          pauseBefore,
          barrier
        ),
      // One byte: every row is its own committed batch.
      maxBatchBytes: 1
    }
    const start = {
      type: 'start',
      client: { connectionString: PG_URL },
      schema,
      mode: 'single-file',
      caseName,
      filePath: VCF,
      vcfOptions: { selectedSample: 'HG005', genomeBuild: 'GRCh38' },
      batchSize: 10_000,
      lease:
        lease === undefined
          ? undefined
          : { holderPid: lease.holderPid, generation: lease.generation }
    } as PostgresImportWorkerStartMessage
    return runImport(deps, start, (m) => messages.push(m)).then(() => messages)
  }

  async function openCoordinator(): Promise<{ client: Client; lease: ImportLease }> {
    const client = new Client({ connectionString: PG_URL })
    const lease = await openImportLease(client as unknown as ImportLeaseClient, schema)
    return { client, lease }
  }

  /**
   * A new owner whose recovery stops just before its first delete of
   * provisional variant rows: it has taken the workspace and selected the
   * `importing` cases, and has deleted nothing yet.
   */
  function openPausedOwner(
    pauseOn: (text: string) => boolean = (text) =>
      text.includes('DELETE FROM') && text.includes('"variants_all"')
  ): {
    lease: Promise<ImportLease>
    recoveryStarted: Promise<void>
    resumeRecovery: () => void
    connection: Client
  } {
    const real = new Client({ connectionString: PG_URL })
    real.on('error', () => undefined)
    const barrier = gate()
    let paused = false
    const client = {
      connect: () => real.connect(),
      end: () => real.end(),
      query: async (sql: string | { text: string }, values?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        if (!paused && pauseOn(text)) {
          paused = true
          barrier.reached.resolve()
          await barrier.resume.promise
        }
        return real.query(sql as never, values as never)
      }
    }
    return {
      lease: openImportLease(client as unknown as ImportLeaseClient, schema),
      recoveryStarted: barrier.reached.promise,
      resumeRecovery: barrier.resume.resolve,
      connection: real
    }
  }

  async function counts(): Promise<{
    allCases: number
    readyCases: number
    provisionalRows: number
    frequencyRows: number
    summaryRows: number
  }> {
    const result = await probe.query<Record<string, string>>(
      `SELECT (SELECT COUNT(*) FROM "${schema}"."cases_all") AS all_cases,
              (SELECT COUNT(*) FROM "${schema}"."cases") AS ready_cases,
              (SELECT COUNT(*) FROM "${schema}"."variants_all") AS provisional_rows,
              (SELECT COUNT(*) FROM "${schema}"."variant_frequency") AS frequency_rows,
              (SELECT COUNT(*) FROM "${schema}"."cohort_variant_summary") AS summary_rows`
    )
    const row = result.rows[0]
    return {
      allCases: Number(row.all_cases),
      readyCases: Number(row.ready_cases),
      provisionalRows: Number(row.provisional_rows),
      frequencyRows: Number(row.frequency_rows),
      summaryRows: Number(row.summary_rows)
    }
  }

  /** End a backend from outside and wait until PostgreSQL has removed it. */
  async function terminateBackend(pid: number): Promise<void> {
    await probe.query('SELECT pg_terminate_backend($1)', [pid])
    const deadline = Date.now() + 15_000
    for (;;) {
      const alive = await probe.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid])
      if (alive.rows.length === 0) return
      if (Date.now() > deadline) throw new Error(`backend ${pid} did not end`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  const NOTHING_LEFT = {
    allCases: 0,
    readyCases: 0,
    provisionalRows: 0,
    frequencyRows: 0,
    summaryRows: 0
  }

  function expectSuperseded(messages: PostgresImportWorkerOutboundMessage[]): void {
    expect(messages.at(-1)).toMatchObject({
      type: 'error',
      code: 'CONFLICT',
      message: expect.stringMatching(/superseded/i)
    })
    expect(messages.some((m) => m.type === 'complete')).toBe(false)
  }

  it('schedule 1: refuses a row batch of an old worker once the new owner’s recovery has started', async () => {
    const old = await openCoordinator()
    const barrier = gate()
    const worker = startWorker('old-operation', old.lease, 6, barrier)
    await barrier.reached.promise
    expect((await counts()).provisionalRows).toBe(6)

    await old.client.end() // the coordinator is lost; its lock is free
    const owner = openPausedOwner()
    await owner.recoveryStarted

    barrier.resume.resolve() // the old worker attempts its next row batch
    expectSuperseded(await worker)
    // Recovery is still paused before its first delete: nothing was added.
    expect(await counts()).toMatchObject({ provisionalRows: 6, readyCases: 0, frequencyRows: 0 })

    owner.resumeRecovery()
    const lease = await owner.lease
    expect(await counts()).toEqual(NOTHING_LEFT)
    await lease.close()
  }, 120_000)

  it('schedule 2: refuses publication by an old worker while recovery runs — no ready case, no cohort contribution', async () => {
    const old = await openCoordinator()
    const barrier = gate()
    const worker = startWorker('old-operation', old.lease, 'end', barrier)
    await barrier.reached.promise
    expect(await counts()).toMatchObject({ allCases: 1, readyCases: 0, provisionalRows: ROWS })

    await old.client.end()
    const owner = openPausedOwner()
    await owner.recoveryStarted

    barrier.resume.resolve() // the old worker attempts publication
    expectSuperseded(await worker)
    expect(await counts()).toMatchObject({ readyCases: 0, frequencyRows: 0, summaryRows: 0 })

    owner.resumeRecovery()
    const lease = await owner.lease
    // The defect: recovery deleted a case that had just become ready and left
    // its cohort contributions behind.
    expect(await counts()).toEqual(NOTHING_LEFT)
    await lease.close()
  }, 120_000)

  it('schedule 4: refuses publication of a case that recovery has already deleted', async () => {
    const old = await openCoordinator()
    const barrier = gate()
    const worker = startWorker('old-operation', old.lease, 'end', barrier)
    await barrier.reached.promise

    await old.client.end()
    const owner = await openCoordinator() // recovery runs to completion
    expect(await counts()).toEqual(NOTHING_LEFT)

    barrier.resume.resolve()
    // Without the fence the worker reports a completed import of a case that
    // no longer exists.
    expectSuperseded(await worker)
    expect(await counts()).toEqual(NOTHING_LEFT)
    await owner.lease.close()
  }, 120_000)

  it('schedule 4: the flip to ready is refused for a deleted case and for a replay', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const request = { filePath: '/tmp/a.vcf.gz', fileSize: 1, genomeBuild: 'GRCh38' }

    const deleted = await repo.beginProvisionalImport(probe as never, {
      ...request,
      caseName: 'deleted-by-recovery'
    })
    await repo.recoverInterruptedImports(probe as never)
    await expect(
      repo.finishProvisionalImport(probe as never, deleted.caseId, 'a.vcf.gz', 'vcf')
    ).rejects.toMatchObject({ name: 'ImportSupersededError', code: 'CONFLICT' })

    const published = await repo.beginProvisionalImport(probe as never, {
      ...request,
      caseName: 'published-once'
    })
    await repo.finishProvisionalImport(probe as never, published.caseId, 'first.vcf.gz', 'vcf')
    await expect(
      repo.finishProvisionalImport(probe as never, published.caseId, 'replay.vcf.gz', 'vcf')
    ).rejects.toMatchObject({ name: 'ImportSupersededError', code: 'CONFLICT' })
    const info = await probe.query<{ import_file_name: string }>(
      `SELECT import_file_name FROM "${schema}"."case_data_info" WHERE case_id = $1`,
      [published.caseId]
    )
    expect(info.rows.map((row) => row.import_file_name)).toEqual(['first.vcf.gz'])
  }, 60_000)

  it('schedule 5: a healthy batch and a healthy single import are unchanged', async () => {
    const { lease } = await openCoordinator()
    const [first, second] = await Promise.all([
      startWorker('healthy-1', lease),
      startWorker('healthy-2', lease)
    ])
    await lease.close()
    const single = await startWorker('healthy-single', undefined)

    for (const messages of [first, second, single]) {
      expect(messages.at(-1)).toMatchObject({ type: 'complete', result: { variantCount: ROWS } })
    }
    const after = await counts()
    expect(after).toMatchObject({ allCases: 3, readyCases: 3, provisionalRows: 3 * ROWS })
    // Three cases of the same rows: one frequency row per coordinate, counted 3 times.
    expect(after.frequencyRows).toBeGreaterThan(0)
    const frequency = await probe.query<{ lowest: string; highest: string }>(
      `SELECT MIN(case_count) AS lowest, MAX(case_count) AS highest
         FROM "${schema}"."variant_frequency"`
    )
    expect(frequency.rows[0]).toEqual({ lowest: '3', highest: '3' })
  }, 120_000)

  it('a worker whose backend is terminated inside a row-batch transaction leaves nothing listed or counted; the next import cleans up', async () => {
    // Pause the worker with its second row batch copied but not committed.
    const barrier = gate()
    let workerPid = 0
    let commits = 0
    const worker = startWorker('terminated', undefined, null, null, (client) => {
      client.on('error', () => undefined)
      const send = client.query.bind(client) as (...args: unknown[]) => unknown
      // Not async: a COPY is a stream that query() must hand back as it is.
      ;(client as unknown as { query: unknown }).query = (...args: unknown[]) => {
        // Commits: the fence for its own recovery, the provisional case,
        // row batch 1, row batch 2.
        if (args[0] !== 'COMMIT' || (commits += 1) !== 4) return send(...args)
        workerPid = (client as unknown as { processID: number }).processID
        barrier.reached.resolve()
        return barrier.resume.promise.then(() => send(...args))
      }
    })
    await barrier.reached.promise
    await terminateBackend(workerPid)
    barrier.resume.resolve()

    const messages = await worker
    expect(messages.at(-1)).toMatchObject({ type: 'error' })
    expect(messages.some((m) => m.type === 'complete')).toBe(false)
    // Its own cleanup could not run. What is left is a hidden case with the
    // one committed row batch: not listed, not counted.
    expect(await counts()).toEqual({
      allCases: 1,
      readyCases: 0,
      provisionalRows: 1,
      frequencyRows: 0,
      summaryRows: 0
    })

    // The next import recovers the workspace first, then imports normally.
    const next = await startWorker('after-termination', undefined)
    expect(next.at(-1)).toMatchObject({ type: 'complete', result: { variantCount: ROWS } })
    const after = await counts()
    expect(after).toMatchObject({ allCases: 1, readyCases: 1, provisionalRows: ROWS })
    const frequency = await probe.query<{ rows: string; lowest: string; highest: string }>(
      `SELECT COUNT(*) AS rows, MIN(case_count) AS lowest, MAX(case_count) AS highest
         FROM "${schema}"."variant_frequency"`
    )
    expect(frequency.rows[0]).toEqual({
      rows: String(after.frequencyRows),
      lowest: '1',
      highest: '1'
    })
  }, 120_000)

  it('recovery whose connection is killed while it holds the fence, after it superseded older imports, is completed by the next recovery', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    await repo.beginProvisionalImport(probe as never, {
      caseName: 'interrupted',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })
    // Stop recovery at its first statement inside the fence.
    const owner = openPausedOwner((text) => text.includes("import_status = 'importing'"))
    const failed = owner.lease.then(
      () => null,
      (error: unknown) => error
    )
    await owner.recoveryStarted
    const held = await probe.query<{ mode: string }>(
      `SELECT mode FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 2
          AND classid = hashtext('varlens-import-fence')::oid
          AND objid = (SELECT oid FROM pg_namespace WHERE nspname = $1)`,
      [schema]
    )
    expect(held.rows).toEqual([{ mode: 'ExclusiveLock' }])
    const superseded = await probe.query<{ value: string }>(
      `SELECT value FROM "${schema}"."database_settings" WHERE key = 'import_generation'`
    )

    await terminateBackend((owner.connection as unknown as { processID: number }).processID)
    owner.resumeRecovery()
    expect(await failed).toBeInstanceOf(Error)
    expect((await counts()).allCases).toBe(1) // nothing was cleaned yet

    // The fence died with the session; the next owner recovers completely.
    const next = await openCoordinator()
    expect(next.lease.generation).toBe(Number(superseded.rows[0].value) + 1)
    expect(await counts()).toEqual(NOTHING_LEFT)
    await next.lease.close()
  }, 120_000)
})
