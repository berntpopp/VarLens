/**
 * Out-of-band SQL phase profiler for perf harnesses.
 *
 * Production import code has no timing hooks, and this profiler keeps it that
 * way: it temporarily wraps `Database.prototype.{prepare,exec,pragma}` of
 * better-sqlite3 from the test process and attributes the wall time of every
 * `exec`, `pragma` and prepared `run` to a named phase chosen from the SQL
 * text, plus the BEGIN/COMMIT overhead of every `db.transaction(...)` call. Time not spent inside SQLite (stream decode, VCF parse, mapping, GC)
 * is whatever remains of a measured window.
 *
 * Cost: two `performance.now()` calls per statement execution. Set
 * `enabled: false` to measure the same run with no wrapping at all.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { performance } from 'node:perf_hooks'

export interface PhaseCell {
  ms: number
  calls: number
}

export type PhaseSnapshot = Record<string, PhaseCell>

/** Exact-text matches take precedence over the generic classifier. */
export type ExactPhase = readonly [sql: string, phase: string]

type AnyFn = (this: unknown, ...args: unknown[]) => unknown
interface PatchablePrototype {
  prepare: AnyFn
  exec: AnyFn
  pragma: AnyFn
  transaction: AnyFn
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^INSERT INTO variants \(/i, 'insert_variants'],
  [/^INSERT INTO variant_(sv|cnv|str) /i, 'insert_extension'],
  [/^INSERT INTO variant_transcripts/i, 'insert_transcripts'],
  [/^INSERT INTO variant_frequency/i, 'variant_frequency_upsert'],
  [/^UPDATE variant_frequency/i, 'variant_frequency_decrement'],
  [/^COMMIT$/i, 'commit'],
  [/^(BEGIN|SAVEPOINT|RELEASE|ROLLBACK)/i, 'txn_control'],
  [/VALUES\s*\('rebuild'\)/i, 'fts_rebuild'],
  [/VALUES\s*\('optimize'\)/i, 'fts_optimize'],
  [/^ANALYZE (cohort_variant_summary|gene_burden_summary)/i, 'analyze_summary'],
  [/^ANALYZE/i, 'analyze'],
  [/^DROP INDEX/i, 'index_drop'],
  [/^CREATE INDEX/i, 'index_recreate'],
  [/TRIGGER/i, 'fts_triggers'],

  // Per-file exact summary upkeep (src/main/database/cohort-summary-case-add-sql.ts).
  [/^UPDATE cohort_variant_summary SET carrier_count/i, 'cohort_add_counts'],
  [/^INSERT INTO cohort_variant_summary/i, 'cohort_add_upsert'],
  [/^UPDATE cohort_variant_summary/i, 'cohort_add_flags'],
  [/^INSERT INTO temp\.added_case_gene_coords/i, 'gene_add_capture'],
  [/^UPDATE temp\.added_case_gene_coords/i, 'gene_add_resolve'],
  [/^INSERT INTO gene_burden_summary/i, 'gene_add_upsert'],
  [/cohort_summary_meta/i, 'summary_meta'],
  [/^wal_checkpoint/i, 'wal_checkpoint'],
  [/^DELETE FROM cases/i, 'delete_case'],
  [/^INSERT INTO (cases|data_info)/i, 'case_bookkeeping'],
  [/^UPDATE cases/i, 'case_bookkeeping']
]

export function classifySql(sql: string, exact: ReadonlyMap<string, string>): string {
  const text = normalize(sql)
  const hit = exact.get(text)
  if (hit !== undefined) return hit
  for (const [pattern, phase] of RULES) {
    if (pattern.test(text)) return phase
  }
  return 'other_sql'
}

export class SqlPhaseProfiler {
  private readonly cells = new Map<string, PhaseCell>()
  private readonly exact: Map<string, string>
  private original: PatchablePrototype | null = null
  /** Running total of all statement time, used to derive transaction overhead. */
  private statementMs = 0

  constructor(
    exactPhases: readonly ExactPhase[] = [],
    private readonly enabled = true
  ) {
    this.exact = new Map(exactPhases.map(([sql, phase]) => [normalize(sql), phase]))
  }

  private cell(phase: string): PhaseCell {
    let cell = this.cells.get(phase)
    if (cell === undefined) {
      cell = { ms: 0, calls: 0 }
      this.cells.set(phase, cell)
    }
    return cell
  }

  /** Time `fn` and attribute it to `phase` (for non-SQL or composite steps). */
  time<T>(phase: string, fn: () => T): T {
    const cell = this.cell(phase)
    const t0 = performance.now()
    try {
      return fn()
    } finally {
      const elapsed = performance.now() - t0
      cell.ms += elapsed
      cell.calls++
      this.statementMs += elapsed
    }
  }

  install(): void {
    if (!this.enabled || this.original !== null) return
    const proto = Database.prototype as unknown as PatchablePrototype
    const original = {
      prepare: proto.prepare,
      exec: proto.exec,
      pragma: proto.pragma,
      transaction: proto.transaction
    }
    this.original = original
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers need both `this` values
    const profiler = this

    const timed = (fn: AnyFn, phasePrefix = ''): AnyFn =>
      function (this: unknown, ...args: unknown[]): unknown {
        const cell = profiler.cell(classifySql(phasePrefix + String(args[0]), profiler.exact))
        const t0 = performance.now()
        try {
          return fn.apply(this, args)
        } finally {
          const elapsed = performance.now() - t0
          cell.ms += elapsed
          cell.calls++
          profiler.statementMs += elapsed
        }
      }

    proto.exec = timed(original.exec)
    proto.pragma = function (this: unknown, ...args: unknown[]): unknown {
      const text = normalize(String(args[0]))
      const phase = /^wal_checkpoint/i.test(text) ? 'wal_checkpoint' : 'pragma'
      return profiler.time(phase, () => original.pragma.apply(this, args))
    }
    proto.prepare = function (this: unknown, ...args: unknown[]): unknown {
      const stmt = original.prepare.apply(this, args) as { run: AnyFn }
      const cell = profiler.cell(classifySql(String(args[0]), profiler.exact))
      const run = stmt.run
      stmt.run = function (this: unknown, ...runArgs: unknown[]): unknown {
        const t0 = performance.now()
        try {
          return run.apply(this, runArgs)
        } finally {
          const elapsed = performance.now() - t0
          cell.ms += elapsed
          cell.calls++
          profiler.statementMs += elapsed
        }
      }
      return stmt
    }
    // better-sqlite3 issues BEGIN/COMMIT through its native handle, so they
    // never reach the wrappers above. Whatever a transaction call costs
    // beyond its timed statements (BEGIN, COMMIT, the caller's row loop) is
    // attributed to `txn_overhead`.
    proto.transaction = function (this: unknown, ...args: unknown[]): unknown {
      const txn = original.transaction.apply(this, args) as AnyFn
      const cell = profiler.cell('txn_overhead')
      return new Proxy(txn, {
        apply(target, thisArg, callArgs: unknown[]): unknown {
          const before = profiler.statementMs
          const t0 = performance.now()
          try {
            return Reflect.apply(target, thisArg, callArgs)
          } finally {
            cell.ms += performance.now() - t0 - (profiler.statementMs - before)
            cell.calls++
          }
        }
      })
    }
  }

  uninstall(): void {
    if (this.original === null) return
    Object.assign(Database.prototype as unknown as PatchablePrototype, this.original)
    this.original = null
  }

  snapshot(): PhaseSnapshot {
    const out: PhaseSnapshot = {}
    for (const [phase, cell] of this.cells) out[phase] = { ms: cell.ms, calls: cell.calls }
    return out
  }
}

/** Per-phase difference `after - before`, dropping phases that did not move. */
export function diffSnapshots(before: PhaseSnapshot, after: PhaseSnapshot): PhaseSnapshot {
  const out: PhaseSnapshot = {}
  for (const [phase, cell] of Object.entries(after)) {
    const prev = before[phase] ?? { ms: 0, calls: 0 }
    const calls = cell.calls - prev.calls
    if (calls > 0) out[phase] = { ms: cell.ms - prev.ms, calls }
  }
  return out
}

export function sumMs(snapshot: PhaseSnapshot): number {
  return Object.values(snapshot).reduce((total, cell) => total + cell.ms, 0)
}
