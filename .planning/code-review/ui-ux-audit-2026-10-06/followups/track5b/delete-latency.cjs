/**
 * Track 5b — concurrent read latency while a large case is deleted (Postgres).
 *
 * Usage (from the repo root):
 *   VARLENS_PG_URL=postgres://…/varlens_nbweb node \
 *     .planning/code-review/ui-ux-audit-2026-10-06/followups/track5b/delete-latency.cjs \
 *     <before|after> [victimRows=1000000] [readers=8] [residentRows=2000000]
 *
 * before = PostgresCaseLifecycleRepository.deleteCase from `main`, loaded from
 *          `.cache/t5b-main-src` (`git archive main src/main src/shared | tar -x`)
 * after  = this branch's implementation (hide transaction + batched purge)
 *
 * Both modes use this branch's schema (migrations through 0018) and this
 * branch's PostgresVariantReadRepository for the reads, so only the delete
 * path differs. Readers page a 20k-variant bystander case (default order,
 * random offset, with COUNT) on a 10-connection pool with the production
 * timeouts (statement 30 s, lock 5 s) for 3 s before the delete, during it,
 * and 2 s after. The delete runs on its own client without a statement timeout.
 */
const { randomBytes } = require('node:crypto')
const { writeFileSync } = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const jiti = require('jiti')(path.join(root, 'noop.js'), { interopDefault: true })
const { Pool, Client } = require('pg')

const mode = process.argv[2]
const VICTIM_ROWS = Number(process.argv[3] ?? 1_000_000)
const READERS = Number(process.argv[4] ?? 8)
// Other cases that stay in the database: the old delete's TRUNCATE + GROUP BY
// rebuild of variant_frequency scans all of them while holding ACCESS EXCLUSIVE.
const RESIDENT_ROWS = Number(process.argv[5] ?? 2_000_000)
const PG_URL = process.env.VARLENS_PG_URL
if (!PG_URL || (mode !== 'before' && mode !== 'after')) {
  console.error('usage: VARLENS_PG_URL=… node delete-latency.cjs <before|after> [rows] [readers]')
  process.exit(2)
}

const src = (rel) => path.join(root, 'src/main/storage', rel)
const mainSrc = (rel) => path.join(root, '.cache/t5b-main-src/src/main/storage', rel)

const { POSTGRES_MIGRATIONS } = jiti(src('postgres/migrations/definitions.ts'))
const { PostgresMigrationRunner } = jiti(src('postgres/migrations/PostgresMigrationRunner.ts'))
const { PostgresCohortSummaryRepository } = jiti(src('postgres/PostgresCohortSummaryRepository.ts'))
const { rebuildVariantFrequencyForCase } = jiti(src('postgres/PostgresJsonImportRepository.ts'))
const { PostgresVariantReadRepository } = jiti(src('postgres/PostgresVariantReadRepository.ts'))
const { getPostgresStorageConfig, buildPostgresPoolConfig } = jiti(src('config.ts'))
const { PostgresCaseLifecycleRepository } = jiti(
  (mode === 'before' ? mainSrc : src)('postgres/PostgresCaseLifecycleRepository.ts')
)

function pct(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b)
  return {
    requests: samples.length,
    errors: samples.filter((s) => !s.ok).length,
    errorKinds: [...new Set(samples.filter((s) => !s.ok).map((s) => s.err))].slice(0, 3),
    p50: pct(ok, 50),
    p95: pct(ok, 95),
    p99: pct(ok, 99),
    max: ok.length ? ok[ok.length - 1] : null
  }
}

async function seed(pool, schema) {
  const summary = new PostgresCohortSummaryRepository()
  const insertCase = async (name, rows) => {
    const res = await pool.query(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, variant_count)
         VALUES ($1, '/bench.vcf', 0, 0, $2) RETURNING id`,
      [name, rows]
    )
    const caseId = Number(res.rows[0].id)
    await pool.query(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gt_num, gene_symbol, consequence)
       SELECT $1, (ARRAY['1','2','3','4','5','6','7','8','9','10','X'])[1 + g % 11],
              1000 + g, 'A', 'T', 'snv', CASE WHEN g % 7 = 0 THEN '1/1' ELSE '0/1' END,
              'G' || (g % 2000), CASE WHEN g % 5 = 0 THEN 'HIGH' ELSE 'LOW' END
         FROM generate_series(1, $2::int) g`,
      [caseId, rows]
    )
    const client = await pool.connect()
    try {
      await client.query('SET statement_timeout = 0')
      await client.query('BEGIN')
      await summary.incrementalAdd({ schema, client, caseId, genomeBuild: 'GRCh38' })
      await summary.refreshColumnMetas({ schema, client, caseId })
      await rebuildVariantFrequencyForCase(client, schema, caseId)
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    return caseId
  }
  const t0 = Date.now()
  const victim = await insertCase('victim', VICTIM_ROWS)
  const bystander = await insertCase('bystander', 20_000)
  if (RESIDENT_ROWS > 0) await insertCase('resident', RESIDENT_ROWS)
  // A few per-case annotations on the victim so the flag hook has work.
  await pool.query(
    `INSERT INTO "${schema}".case_variant_annotations
       (case_id, variant_id, starred, created_at, updated_at)
     SELECT case_id, id, 1, 0, 0 FROM "${schema}".variants_all
      WHERE case_id = $1 AND id % 997 = 0`,
    [victim]
  )
  await pool.query(`ANALYZE`)
  return { victim, bystander, seedMs: Date.now() - t0 }
}

async function main() {
  const schema = `t5b_bench_${mode}_${Date.now()}_${randomBytes(3).toString('hex')}`
  const admin = new Client({ connectionString: PG_URL })
  await admin.connect()
  await admin.query(`CREATE SCHEMA "${schema}"`)
  await admin.end()

  const config = getPostgresStorageConfig({ VARLENS_PG_URL: PG_URL, VARLENS_PG_SCHEMA: schema })
  const setup = new Pool({ connectionString: PG_URL, max: 2, statement_timeout: 0 })
  await new PostgresMigrationRunner(setup, schema, POSTGRES_MIGRATIONS).migrate()
  const { victim, bystander, seedMs } = await seed(setup, schema)

  const readPool = new Pool(buildPostgresPoolConfig(config))
  const reader = new PostgresVariantReadRepository(readPool, schema)
  const deletePool = new Pool({ connectionString: PG_URL, max: 2, statement_timeout: 0 })
  const lifecycle = new PostgresCaseLifecycleRepository(deletePool, schema)

  let phase = 'baseline'
  let stop = false
  const samples = { baseline: [], during: [], after: [] }
  const worker = async () => {
    while (!stop) {
      const started = performance.now()
      const bucket = samples[phase]
      try {
        await reader.queryVariants(
          { case_id: bystander },
          50,
          Math.floor(Math.random() * 19_000),
          undefined,
          false,
          false
        )
        bucket.push({ ok: true, ms: performance.now() - started })
      } catch (err) {
        bucket.push({ ok: false, ms: performance.now() - started, err: String(err.message) })
      }
    }
  }
  const workers = Array.from({ length: READERS }, worker)

  await new Promise((r) => setTimeout(r, 3000))
  phase = 'during'
  const t0 = performance.now()
  let deleteError = null
  try {
    await lifecycle.deleteCase(victim)
  } catch (err) {
    deleteError = String(err.message)
  }
  const deleteMs = performance.now() - t0
  phase = 'after'
  await new Promise((r) => setTimeout(r, 2000))
  stop = true
  await Promise.all(workers)

  const remaining = await setup.query(
    `SELECT count(*)::int AS n FROM "${schema}".variants_all WHERE case_id = $1`,
    [victim]
  )
  const result = {
    mode,
    victimRows: VICTIM_ROWS,
    residentRows: RESIDENT_ROWS,
    readers: READERS,
    poolMax: config.poolMax,
    seedMs,
    deleteMs: Math.round(deleteMs),
    deleteError,
    victimRowsRemaining: remaining.rows[0].n,
    baseline: summarize(samples.baseline),
    during: summarize(samples.during),
    after: summarize(samples.after)
  }
  await readPool.end()
  await deletePool.end()
  await setup.query(`DROP SCHEMA "${schema}" CASCADE`)
  await setup.end()

  const out = path.join(__dirname, `delete-latency-${mode}.json`)
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

main().catch((err) => {
  process.stderr.write(String(err.stack ?? err) + '\n')
  process.exit(1)
})
