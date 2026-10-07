import { describe, expect, it, vi } from 'vitest'

import { InvalidParametersError } from '../../../src/main/ipc/errors'
import {
  CaseDeletionInterruptedError,
  PostgresCaseLifecycleRepository
} from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'

/** Normalise a query(...) arg into the SQL text (string or named config). */
function sqlText(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg && typeof arg === 'object' && typeof (arg as { text?: unknown }).text === 'string') {
    return (arg as { text: string }).text
  }
  return ''
}

interface CaseRow {
  genome_build: string
  import_status: string
  variant_count: number
}

function makePool(
  caseRow: CaseRow | null = {
    genome_build: 'GRCh38',
    import_status: 'ready',
    variant_count: 12
  },
  purgeBatches: number[] = [0]
) {
  const remaining = [...purgeBatches]
  const client = {
    query: vi.fn(async (arg: unknown) => {
      if (sqlText(arg).includes('FOR UPDATE')) return { rows: caseRow === null ? [] : [caseRow] }
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn()
  }
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (arg: unknown) => {
      const sql = sqlText(arg)
      if (sql.includes('DELETE FROM') && sql.includes('"variants_all"')) {
        return { rows: [], rowCount: remaining.shift() ?? 0 }
      }
      return { rows: [], rowCount: 0 }
    })
  }
  return { client, pool }
}

function makeSummary() {
  return {
    removeColumnMetas: vi.fn(async () => undefined)
  }
}

function clientSql(client: { query: { mock: { calls: unknown[][] } } }): string[] {
  return client.query.mock.calls.map(([arg]) => sqlText(arg))
}

describe('PostgresCaseLifecycleRepository — non-blocking deletion', () => {
  it('never TRUNCATEs or rebuilds a global table (blocking audit W-1)', async () => {
    const { client, pool } = makePool()
    const repo = new PostgresCaseLifecycleRepository(
      pool as never,
      'public',
      makeSummary() as never
    )

    await repo.deleteCase(7)

    const all = [...clientSql(client), ...pool.query.mock.calls.map(([arg]) => sqlText(arg))]
    expect(all.some((sql) => /TRUNCATE/i.test(sql))).toBe(false)
    expect(all.some((sql) => sql.includes('INSERT INTO "public"."variant_frequency"'))).toBe(false)
  })

  it('hides the case in one transaction with case-scoped maintenance before the status flip', async () => {
    const { client, pool } = makePool()
    const summary = makeSummary()
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

    const result = await repo.hideCase(7)

    expect(result).toEqual({ state: 'hidden', genomeBuild: 'GRCh38', variantCount: 12 })
    const sql = clientSql(client)
    expect(sql[0]).toBe('BEGIN')
    expect(sql.at(-1)).toBe('COMMIT')
    const idx = (needle: string): number => sql.findIndex((s) => s.includes(needle))
    const flags = idx('v.case_id <> $1')
    const subtract = idx('carrier_count = cvs.carrier_count - per_case.carrier_delta')
    const vfDecrement = idx('SET case_count = vf.case_count - 1')
    const flip = idx("SET import_status = 'deleting'")
    expect(flags).toBeGreaterThan(0)
    expect(subtract).toBeGreaterThan(flags)
    expect(vfDecrement).toBeGreaterThan(subtract)
    expect(flip).toBeGreaterThan(vfDecrement)
    // Zero-carrier cleanup is scoped to the case's coordinates.
    expect(sql[idx('cvs.carrier_count <= 0')]).toContain('WHERE case_id = $1')
    expect(summary.removeColumnMetas).toHaveBeenCalledWith(
      expect.objectContaining({ schema: 'public', caseId: 7 })
    )
    // The rename frees the UNIQUE case name for an immediate re-import.
    expect(sql[flip]).toContain('name = $2::text')
  })

  it('refuses to delete a case that is still importing', async () => {
    const { client, pool } = makePool({
      genome_build: 'GRCh38',
      import_status: 'importing',
      variant_count: 0
    })
    const repo = new PostgresCaseLifecycleRepository(
      pool as never,
      'public',
      makeSummary() as never
    )

    await expect(repo.hideCase(7)).rejects.toBeInstanceOf(InvalidParametersError)
    expect(clientSql(client)).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('resumes an already-hidden case without re-applying the decrements', async () => {
    const { client, pool } = makePool({
      genome_build: 'GRCh37',
      import_status: 'deleting',
      variant_count: 3
    })
    const summary = makeSummary()
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

    await repo.deleteCase(7)

    expect(clientSql(client).some((sql) => sql.includes('per_case.carrier_delta'))).toBe(false)
    expect(clientSql(client).some((sql) => sql.includes('cohort_frequency'))).toBe(false)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "public"."cases_all" WHERE id = $1'),
      [7]
    )
  })

  it('is a no-op for a missing case', async () => {
    const { pool } = makePool(null)
    const summary = makeSummary()
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

    await expect(repo.deleteCase(999)).resolves.toBeUndefined()
    expect(summary.removeColumnMetas).not.toHaveBeenCalled()
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('purges variants in bounded batches until a short batch, reporting progress', async () => {
    const { pool } = makePool(undefined, [2, 2, 1])
    const repo = new PostgresCaseLifecycleRepository(
      pool as never,
      'public',
      makeSummary() as never
    )
    const progress: number[] = []

    const purged = await repo.purgeCaseVariants(
      7,
      { batchSize: 2, onProgress: (p) => progress.push(p.done) },
      5
    )

    expect(purged).toBe(5)
    expect(progress).toEqual([2, 4, 5])
    const deletes = pool.query.mock.calls.filter(([arg]) => sqlText(arg).includes('LIMIT $2'))
    expect(deletes).toHaveLength(3)
    expect(deletes[0][1]).toEqual([7, 2])
  })

  it('stops between batches when aborted', async () => {
    const { pool } = makePool(undefined, [2, 2, 2])
    const repo = new PostgresCaseLifecycleRepository(
      pool as never,
      'public',
      makeSummary() as never
    )
    const controller = new AbortController()

    await expect(
      repo.purgeCaseVariants(7, {
        batchSize: 2,
        signal: controller.signal,
        onProgress: () => controller.abort()
      })
    ).rejects.toBeInstanceOf(CaseDeletionInterruptedError)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('runs purge then finalize and only deletes rows still marked deleting', async () => {
    const { pool } = makePool(undefined, [3])
    const order: string[] = []
    const summary = makeSummary()
    pool.query.mockImplementation(async (arg: unknown) => {
      const sql = sqlText(arg)
      if (sql.includes('"variants_all"')) order.push('purge')
      if (sql.includes('DELETE FROM "public"."cases_all"')) {
        order.push('finalize')
        expect(sql).toContain("import_status = 'deleting'")
      }
      return { rows: [], rowCount: 0 }
    })
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public', summary as never)

    await repo.deleteCase(7)

    expect(order).toEqual(['purge', 'finalize'])
  })

  it('preserves the original error when rollback fails during hide', async () => {
    const { client, pool } = makePool()
    const boom = new Error('lock timeout')
    client.query.mockImplementation(async (arg: unknown) => {
      const sql = sqlText(arg)
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ genome_build: 'GRCh38', import_status: 'ready', variant_count: 1 }] }
      }
      if (sql.includes('per_case.carrier_delta')) throw boom
      if (sql === 'ROLLBACK') throw new Error('rollback failed')
      return { rows: [] }
    })
    const repo = new PostgresCaseLifecycleRepository(
      pool as never,
      'public',
      makeSummary() as never
    )

    await expect(repo.deleteCase(7)).rejects.toBe(boom)
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
