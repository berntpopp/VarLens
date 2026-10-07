/**
 * Result fingerprint, statement-level diagnostics and markdown rendering for
 * the SQLite batch-import benchmark (tests/perf/sqlite-batch-import.perf.test.ts).
 */
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

import { RECREATE_INDEXES } from '../../../src/main/workers/import-index-sql'
import { openWorkerDatabase } from '../../../src/main/workers/worker-db'
import {
  INCREMENTAL_ADD_SQL,
  REBUILD_GENE_BURDEN_SQL,
  REBUILD_VARIANT_SUMMARY_SQL,
  RECOMPUTE_ALL_FREQUENCIES_SQL
} from '../../../src/shared/sql/cohort-summary-rebuild'
import type { PhaseSnapshot } from './sql-phase-profiler'

export interface BatchFingerprint {
  counts: Record<string, number>
  isStale: string | null
  sums: Record<string, number>
  /** sha256 over key + carrier/het/hom counts, ordered by key. */
  carrierHash: string
  /** sha256 over key + stored `cohort_frequency` (what cohort readers select). */
  cohortFrequencyHash: string
  geneBurdenHash: string
  variantFrequencyHash: string
}

const fileSize = (path: string): number => (existsSync(path) ? statSync(path).size : 0)

export function dbSizes(dbPath: string): { dbBytes: number; walBytes: number } {
  return { dbBytes: fileSize(dbPath), walBytes: fileSize(`${dbPath}-wal`) }
}

function hashRows(db: DatabaseType, sql: string): string {
  const hash = createHash('sha256')
  for (const row of db.prepare(sql).raw().iterate() as IterableIterator<unknown[]>) {
    hash.update(row.join('\t'))
    hash.update('\n')
  }
  return hash.digest('hex')
}

const count = (db: DatabaseType, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

export function fingerprintDatabase(dbPath: string): BatchFingerprint {
  const db = new Database(dbPath, { readonly: true })
  try {
    const key = 'chr, pos, ref, alt, variant_type, genome_build'
    const tables = [
      'cases',
      'variants',
      'cohort_variant_summary',
      'gene_burden_summary',
      'variant_frequency',
      'variants_fts'
    ]
    const stale = db
      .prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'")
      .get() as { value: string } | undefined
    const sums = db
      .prepare(
        `SELECT SUM(carrier_count) AS carrier, SUM(het_count) AS het, SUM(hom_count) AS hom,
                ROUND(SUM(cohort_frequency), 6) AS cohortFrequency
         FROM cohort_variant_summary`
      )
      .get() as Record<string, number>
    return {
      counts: Object.fromEntries(tables.map((table) => [table, count(db, table)])),
      isStale: stale?.value ?? null,
      sums,
      carrierHash: hashRows(
        db,
        `SELECT ${key}, carrier_count, het_count, hom_count FROM cohort_variant_summary ORDER BY ${key}`
      ),
      cohortFrequencyHash: hashRows(
        db,
        `SELECT ${key}, printf('%.9f', cohort_frequency) FROM cohort_variant_summary ORDER BY ${key}`
      ),
      geneBurdenHash: hashRows(
        db,
        `SELECT gene_symbol, genome_build, variant_count, unique_variant_count, affected_case_count
         FROM gene_burden_summary ORDER BY gene_symbol, genome_build`
      ),
      variantFrequencyHash: hashRows(
        db,
        'SELECT chr, pos, ref, alt, case_count FROM variant_frequency ORDER BY chr, pos, ref, alt'
      )
    }
  } finally {
    db.close()
  }
}

export interface DiagnosticRow {
  step: string
  ms: number
}

const splitStatements = (sql: string): string[] =>
  sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')

const label = (statement: string): string => statement.replace(/\s+/g, ' ').slice(0, 72)

/**
 * Time individual statements on a throwaway COPY of the finished database,
 * opened with the import worker's PRAGMAs. Splits the multi-statement
 * end-of-batch steps the main pass can only see as one `exec`, and prices the
 * `CohortSummaryService.incrementalAdd` statements at final cohort size.
 */
export function runStatementDiagnostics(copyPath: string): DiagnosticRow[] {
  const db = openWorkerDatabase(copyPath)
  const rows: DiagnosticRow[] = []
  const time = (step: string, fn: () => void): void => {
    const t0 = performance.now()
    fn()
    rows.push({ step, ms: performance.now() - t0 })
  }
  try {
    for (const create of splitStatements(RECREATE_INDEXES)) {
      const name = /INDEX IF NOT EXISTS (\w+)/.exec(create)?.[1]
      if (name === undefined) continue
      db.exec(`DROP INDEX IF EXISTS ${name}`)
      time(`recreate index ${name}`, () => db.exec(create))
    }
    db.exec('BEGIN')
    for (const statement of splitStatements(REBUILD_VARIANT_SUMMARY_SQL)) {
      time(`summary rebuild: ${label(statement)}`, () => db.exec(statement))
    }
    for (const statement of splitStatements(REBUILD_GENE_BURDEN_SQL)) {
      time(`gene burden: ${label(statement)}`, () => db.exec(statement))
    }
    db.exec('COMMIT')
    time('ANALYZE (whole database)', () => db.exec('ANALYZE'))
    time('ANALYZE cohort_variant_summary', () => db.exec('ANALYZE cohort_variant_summary'))

    const lastCase = db.prepare('SELECT MAX(id) AS id FROM cases').get() as { id: number | null }
    db.exec('BEGIN')
    time('incrementalAdd: RECOMPUTE_ALL_FREQUENCIES_SQL (full-table rewrite)', () =>
      db.exec(RECOMPUTE_ALL_FREQUENCIES_SQL)
    )
    if (lastCase.id !== null) {
      const add = db.prepare(INCREMENTAL_ADD_SQL)
      time('incrementalAdd: INCREMENTAL_ADD_SQL (last case, replayed)', () => add.run(lastCase.id))
    }
    db.exec('ROLLBACK')
  } finally {
    db.close()
  }
  return rows
}

export interface SampleResult {
  index: number
  fileName: string
  variantCount: number
  wallMs: number
  sqlMs: number
  /** wallMs - sqlMs: gunzip, line parse, mapping, GC. */
  parseMapMs: number
  phases: PhaseSnapshot
  dbBytes: number
  walBytes: number
  rssBytes: number
  summaryRowsAfterFile: number
  isStaleAfterFile: string | null
}

export interface BatchReport {
  label: string
  timestamp: string
  environment: Record<string, string | number | boolean>
  samples: SampleResult[]
  sessionStart: PhaseSnapshot
  batchEnd: PhaseSnapshot
  totals: Record<string, number>
  totalPhases: PhaseSnapshot
  finalSizes: { dbBytes: number; walBytes: number }
  fingerprint: BatchFingerprint
  diagnostics: DiagnosticRow[]
}

const seconds = (ms: number): string => (ms / 1000).toFixed(2)
const megabytes = (bytes: number): string => (bytes / 1_048_576).toFixed(1)

function phaseTable(title: string, columns: Array<[string, PhaseSnapshot]>): string[] {
  const phases = new Set<string>()
  for (const [, snapshot] of columns) for (const phase of Object.keys(snapshot)) phases.add(phase)
  const last = columns[columns.length - 1][1]
  const ordered = [...phases].sort((a, b) => (last[b]?.ms ?? 0) - (last[a]?.ms ?? 0))
  return [
    `## ${title}`,
    '',
    `| phase | ${columns.map(([name]) => `${name} (s)`).join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    ...ordered.map(
      (phase) =>
        `| ${phase} | ${columns.map(([, s]) => (s[phase] ? seconds(s[phase].ms) : '-')).join(' | ')} |`
    ),
    ''
  ]
}

export function renderMarkdown(report: BatchReport): string {
  const { samples, fingerprint, totals } = report
  const first = samples[0]
  const lastSample = samples[samples.length - 1]
  const withParse = (s: SampleResult): PhaseSnapshot => ({
    ...s.phases,
    'parse_map (wall - sql)': { ms: s.parseMapMs, calls: 1 }
  })
  const lines = [
    `# SQLite batch import benchmark — ${report.label}`,
    '',
    `- timestamp: ${report.timestamp}`,
    ...Object.entries(report.environment).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Totals',
    '',
    ...Object.entries(totals).map(([key, ms]) => `- ${key}: ${seconds(ms)} s`),
    `- final DB: ${megabytes(report.finalSizes.dbBytes)} MiB (+ WAL ${megabytes(report.finalSizes.walBytes)} MiB)`,
    '',
    '## Per sample',
    '',
    '| # | file | variants | wall (s) | parse/map (s) | sql (s) | db MiB | wal MiB | rss MiB | summary rows | is_stale |',
    '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...samples.map(
      (s) =>
        `| ${s.index + 1} | ${s.fileName} | ${s.variantCount} | ${seconds(s.wallMs)} | ${seconds(s.parseMapMs)} | ${seconds(s.sqlMs)} | ${megabytes(s.dbBytes)} | ${megabytes(s.walBytes)} | ${megabytes(s.rssBytes)} | ${s.summaryRowsAfterFile} | ${s.isStaleAfterFile} |`
    ),
    '',
    ...(first !== undefined && lastSample !== undefined
      ? phaseTable('Per-file phases', [
          ['first sample', withParse(first)],
          ['last sample', withParse(lastSample)],
          [
            'all samples',
            samples.reduce<PhaseSnapshot>((acc, s) => {
              for (const [phase, cell] of Object.entries(withParse(s))) {
                const prev = acc[phase] ?? { ms: 0, calls: 0 }
                acc[phase] = { ms: prev.ms + cell.ms, calls: prev.calls + cell.calls }
              }
              return acc
            }, {})
          ]
        ])
      : []),
    ...phaseTable('Once per batch', [
      ['session start', report.sessionStart],
      ['batch end', report.batchEnd]
    ]),
    '## Result fingerprint',
    '',
    ...Object.entries(fingerprint.counts).map(([table, rows]) => `- rows ${table}: ${rows}`),
    `- is_stale: ${fingerprint.isStale}`,
    `- sums: ${JSON.stringify(fingerprint.sums)}`,
    `- carrier/het/hom sha256: ${fingerprint.carrierHash}`,
    `- cohort_frequency sha256: ${fingerprint.cohortFrequencyHash}`,
    `- gene_burden_summary sha256: ${fingerprint.geneBurdenHash}`,
    `- variant_frequency sha256: ${fingerprint.variantFrequencyHash}`,
    '',
    '## Statement diagnostics (replayed on a copy of the final database)',
    '',
    '| step | s |',
    '|---|---:|',
    ...report.diagnostics.map(
      (row) => `| ${row.step.replace(/\|/g, '\\|')} | ${seconds(row.ms)} |`
    ),
    ''
  ]
  return lines.join('\n')
}
