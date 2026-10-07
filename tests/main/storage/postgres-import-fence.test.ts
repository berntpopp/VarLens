/**
 * Import recovery fence with mocked connections: statement order, refusals
 * and lock release. The schedules against a real PostgreSQL instance are in
 * postgres-import-fence-schedules.test.ts and postgres-import-fence-locks.test.ts
 * (gated); these run in every mode.
 */
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import {
  beginFencedImportTransaction,
  IMPORT_FENCE_BUSY_MESSAGE,
  ImportSupersededError,
  withExclusiveImportFence
} from '../../../src/main/storage/postgres/postgres-import-fence'
import {
  openImportLease,
  type ImportLeaseClient
} from '../../../src/main/storage/postgres/postgres-import-lease'
import { PostgresVcfImportRepository } from '../../../src/main/storage/postgres/PostgresVcfImportRepository'
import { runImport } from '../../../src/main/workers/postgres-import-worker'

type Answer = { rows: unknown[]; rowCount?: number }
type Responder = (text: string, values: unknown[] | undefined) => Answer | undefined

/** A connection that records every statement and answers from `respond`. */
function recordingClient(respond: Responder = () => undefined) {
  const texts: string[] = []
  const client = {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string | { text: string }, values?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      texts.push(text)
      return respond(text, values) ?? { rows: [] }
    })
  }
  return { client, texts }
}

/** Answers of a healthy fence: lock granted, generation `generation`. */
function healthyFence(generation: number, isolation = 'read committed'): Responder {
  return (text) => {
    if (text.includes('pg_try_advisory_xact_lock_shared')) return { rows: [{ locked: true }] }
    if (text.includes('ON CONFLICT (key) DO UPDATE')) {
      return { rows: [{ generation: String(generation) }] }
    }
    if (text.includes("current_setting('transaction_isolation')")) {
      return { rows: [{ generation: String(generation), isolation }] }
    }
    return undefined
  }
}

const fence = { schema: 'ws', generation: 7 }
const SUPERSEDED = { name: 'ImportSupersededError', code: 'CONFLICT' }

describe('beginFencedImportTransaction', () => {
  it('takes the fence in shared mode inside the transaction, then compares the generation', async () => {
    const { client, texts } = recordingClient(healthyFence(7))

    await beginFencedImportTransaction(client, fence)

    expect(texts).toHaveLength(3)
    expect(texts[0]).toBe('BEGIN')
    expect(texts[1]).toContain(
      "pg_try_advisory_xact_lock_shared(hashtext('varlens-import-fence'), n.oid::int4) AS locked FROM pg_namespace n WHERE n.nspname = $1"
    )
    expect(client.query.mock.calls[1][1]).toEqual(['ws'])
    expect(texts[2]).toContain(`FROM "ws"."database_settings" WHERE key = 'import_generation'`)
  })

  it('refuses at once, without waiting or writing, when recovery holds or requests the fence', async () => {
    const { client, texts } = recordingClient((text) =>
      text.includes('pg_try_advisory_xact_lock_shared') ? { rows: [{ locked: false }] } : undefined
    )

    await expect(beginFencedImportTransaction(client, fence)).rejects.toMatchObject(SUPERSEDED)

    expect(texts).toEqual(['BEGIN', expect.stringContaining('pg_try_advisory'), 'ROLLBACK'])
  })

  it('refuses when a recovery has advanced the generation', async () => {
    const { client, texts } = recordingClient(healthyFence(8))

    await expect(beginFencedImportTransaction(client, fence)).rejects.toBeInstanceOf(
      ImportSupersededError
    )

    expect(texts.at(-1)).toBe('ROLLBACK')
  })

  it('fails closed when PostgreSQL confirms neither the lock nor the generation', async () => {
    const silent = recordingClient()
    await expect(beginFencedImportTransaction(silent.client, fence)).rejects.toMatchObject(
      SUPERSEDED
    )

    // The first recovery has not run: there is no generation row yet.
    const noGeneration = recordingClient((text) => {
      if (text.includes('pg_try_advisory_xact_lock_shared')) return { rows: [{ locked: true }] }
      if (text.includes('transaction_isolation')) {
        return { rows: [{ generation: null, isolation: 'read committed' }] }
      }
      return undefined
    })
    await expect(beginFencedImportTransaction(noGeneration.client, fence)).rejects.toMatchObject(
      SUPERSEDED
    )
    expect(noGeneration.texts.at(-1)).toBe('ROLLBACK')
  })
})

describe('beginFencedImportTransaction — isolation', () => {
  it('refuses a transaction whose generation read would not see a committed recovery', async () => {
    const { client, texts } = recordingClient(healthyFence(7, 'repeatable read'))

    await expect(beginFencedImportTransaction(client, fence)).rejects.toThrow(/READ COMMITTED/)

    expect(texts.at(-1)).toBe('ROLLBACK')
  })
})

describe('withExclusiveImportFence', () => {
  const lockTimeout = (): never => {
    throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
  }

  it('bounds the wait, advances the generation, runs the operation and releases the fence', async () => {
    const { client, texts } = recordingClient(healthyFence(12))
    const operation = vi.fn(async (generation: number) => `ran under ${generation}`)

    await expect(withExclusiveImportFence(client, 'ws', operation)).resolves.toBe('ran under 12')

    expect(texts.map((text) => text.replace(/\s+/g, ' ').trim())).toEqual([
      'BEGIN',
      "SELECT set_config('lock_timeout', $1, true)",
      "SELECT pg_advisory_lock(hashtext('varlens-import-fence'), n.oid::int4) AS locked FROM pg_namespace n WHERE n.nspname = $1",
      'COMMIT',
      `INSERT INTO "ws"."database_settings" AS s (key, value) VALUES ('import_generation', '1') ON CONFLICT (key) DO UPDATE SET value = (s.value::bigint + 1)::text WHERE s.value ~ '^[0-9]{1,15}$' RETURNING value AS generation`,
      "SELECT pg_advisory_unlock(hashtext('varlens-import-fence'), n.oid::int4) AS locked FROM pg_namespace n WHERE n.nspname = $1"
    ])
    expect(client.query.mock.calls[1][1]).toEqual(['30000ms'])
  })

  it('releases the fence when the operation fails, and keeps that failure', async () => {
    const { client, texts } = recordingClient(healthyFence(12))

    await expect(
      withExclusiveImportFence(client, 'ws', async () => {
        throw new Error('cleanup failed')
      })
    ).rejects.toThrow('cleanup failed')

    expect(texts.at(-1)).toContain('pg_advisory_unlock')
  })

  it('terminates holders that outlive the bound and retries', async () => {
    let waits = 0
    const { client, texts } = recordingClient((text) => {
      if (text.includes('pg_advisory_lock(')) {
        waits += 1
        if (waits === 1) lockTimeout()
      }
      return healthyFence(3)(text, undefined)
    })

    await expect(
      withExclusiveImportFence(client, 'ws', async (generation) => generation, { waitMs: 50 })
    ).resolves.toBe(3)

    const terminate = texts.findIndex((text) => text.includes('pg_terminate_backend'))
    expect(terminate).toBeGreaterThan(texts.indexOf('ROLLBACK'))
    expect(texts[terminate]).toContain("mode = 'ShareLock'")
    expect(texts[terminate]).toContain('current_database()')
    expect(texts[terminate]).toContain('pid <> pg_backend_pid()')
    expect(waits).toBe(2)
  })

  it('only ever terminates import connections of this workspace, this database and this role', async () => {
    let waits = 0
    const { client, texts } = recordingClient((text) => {
      if (text.includes('pg_advisory_lock(') && (waits += 1) === 1) lockTimeout()
      return healthyFence(3)(text, undefined)
    })

    await withExclusiveImportFence(client, 'ws', async () => undefined, { waitMs: 50 })

    const terminate = texts.find((text) => text.includes('pg_terminate_backend')) ?? ''
    // The fence of exactly this schema: keyed by its namespace oid.
    expect(terminate).toContain("l.classid = hashtext('varlens-import-fence')::oid")
    expect(terminate).toContain('l.objid = n.oid')
    expect(terminate).toContain('JOIN pg_stat_activity a ON a.pid = l.pid')
    expect(terminate).toContain('a.datname = current_database()')
    expect(terminate).toContain('a.usename = current_user')
    expect(terminate).toContain("' varlens-import:' || n.oid")
  })

  it('still ends in the bounded conflict when a holder cannot be signalled', async () => {
    const { client, texts } = recordingClient((text) => {
      if (text.includes('pg_advisory_lock(')) lockTimeout()
      if (text.includes('pg_terminate_backend')) {
        throw Object.assign(new Error('permission denied to terminate process'), { code: '42501' })
      }
      return undefined
    })

    await expect(
      withExclusiveImportFence(client, 'ws', vi.fn(), { waitMs: 50 })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: IMPORT_FENCE_BUSY_MESSAGE })

    expect(texts.filter((text) => text.includes('pg_advisory_lock('))).toHaveLength(3)
    expect(texts.filter((text) => text.includes('pg_terminate_backend'))).toHaveLength(2)
  })

  it('gives up with a busy conflict after the last attempt and changes nothing', async () => {
    const { client, texts } = recordingClient((text) =>
      text.includes('pg_advisory_lock(') ? lockTimeout() : undefined
    )
    const operation = vi.fn()

    await expect(
      withExclusiveImportFence(client, 'ws', operation, { waitMs: 50, attempts: 2 })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: IMPORT_FENCE_BUSY_MESSAGE })

    expect(operation).not.toHaveBeenCalled()
    expect(texts.some((text) => text.includes('ON CONFLICT (key)'))).toBe(false)
    expect(texts.filter((text) => text.includes('pg_terminate_backend'))).toHaveLength(1)
    expect(texts.some((text) => text.includes('pg_advisory_unlock'))).toBe(false)
  })
})

describe('import generation value', () => {
  it('advances only a numeric value; the statement cannot fail on a damaged one', async () => {
    const { client, texts } = recordingClient(healthyFence(4))

    await withExclusiveImportFence(client, 'ws', async () => undefined)

    const advance = texts.find((text) => text.includes('ON CONFLICT (key)')) ?? ''
    expect(advance).toContain("WHERE s.value ~ '^[0-9]{1,15}$'")
  })

  it('fails recovery with a typed, actionable error when the stored value is not a number', async () => {
    // The guarded statement changes no row and returns none.
    const { client, texts } = recordingClient((text) =>
      text.includes('ON CONFLICT (key)') ? { rows: [] } : healthyFence(4)(text, undefined)
    )
    const operation = vi.fn()

    await expect(withExclusiveImportFence(client, 'ws', operation)).rejects.toMatchObject({
      name: 'ImportGenerationInvalidError',
      code: 'CONFLICT',
      userMessage: expect.stringMatching(/import_generation.*database_settings/)
    })

    expect(operation).not.toHaveBeenCalled()
    // Nothing is left held on the connection.
    const lockAt = texts.findIndex((text) => text.includes('pg_advisory_lock('))
    if (lockAt !== -1) expect(texts.at(-1)).toContain('pg_advisory_unlock')
  })
})

describe('PostgresVcfImportRepository under the fence', () => {
  it('recovery holds the fence for the whole pass and returns the new generation', async () => {
    const { client, texts } = recordingClient((text) => {
      if (text.includes("import_status = 'importing'")) {
        return { rows: [{ id: '5', import_variant_watermark: '0', import_is_new: true }] }
      }
      return healthyFence(21)(text, undefined)
    })

    const generation = await new PostgresVcfImportRepository('ws').recoverInterruptedImports(
      client as never
    )

    expect(generation).toBe(21)
    const index = (part: string): number => texts.findIndex((text) => text.includes(part))
    expect(index('pg_advisory_lock(')).toBeLessThan(index('ON CONFLICT (key)'))
    expect(index('ON CONFLICT (key)')).toBeLessThan(index("import_status = 'importing'"))
    expect(index('DELETE FROM "ws"."cases_all"')).toBeLessThan(index('pg_advisory_unlock'))
    // Recovery owns the fence exclusively; its own transactions do not take it shared.
    expect(index('pg_try_advisory_xact_lock_shared')).toBe(-1)
  })

  it('publishes only a case that is still importing under the same generation', async () => {
    const { client, texts } = recordingClient((text) =>
      text.startsWith('UPDATE') ? { rows: [], rowCount: 1 } : undefined
    )

    await new PostgresVcfImportRepository('ws').finishProvisionalImport(
      client as never,
      5,
      'a.vcf',
      'vcf',
      fence
    )

    expect(texts[0]).toContain(`WHERE id = $1 AND import_status = 'importing'`)
    expect(texts[0]).toContain(
      `(SELECT value FROM "ws"."database_settings" WHERE key = 'import_generation') = $2`
    )
    expect(client.query.mock.calls[0][1]).toEqual([5, '7'])
    expect(texts[1]).toContain('"case_data_info"')
  })

  it('refuses a publication that flips no case, before writing its file record', async () => {
    const { client, texts } = recordingClient((text) =>
      text.startsWith('UPDATE') ? { rows: [], rowCount: 0 } : undefined
    )

    await expect(
      new PostgresVcfImportRepository('ws').finishProvisionalImport(client as never, 5, 'a', 'vcf')
    ).rejects.toMatchObject(SUPERSEDED)

    expect(texts).toHaveLength(1)
  })

  it('a worker’s own cleanup is refused under a superseded generation and deletes nothing', async () => {
    const { client, texts } = recordingClient(healthyFence(8))

    await expect(
      new PostgresVcfImportRepository('ws').cleanupProvisionalImport(
        client as never,
        { caseId: 5, watermark: 0, isNew: true },
        { fence }
      )
    ).rejects.toMatchObject(SUPERSEDED)

    expect(texts.some((text) => text.includes('DELETE'))).toBe(false)
  })
})

describe('lease and worker', () => {
  it('a batch lease carries the generation of its opening recovery', async () => {
    const { client } = recordingClient((text) => {
      if (text.includes('pg_try_advisory_lock(')) return { rows: [{ locked: true }] }
      if (text.includes('pg_backend_pid')) return { rows: [{ pid: 4242 }] }
      return healthyFence(33)(text, undefined)
    })

    const lease = await openImportLease(client as unknown as ImportLeaseClient, 'ws')

    expect(lease).toMatchObject({ holderPid: 4242, generation: 33 })
  })

  it('a leased worker of a superseded batch reports a typed conflict and writes nothing', async () => {
    const { client, texts } = recordingClient((text) => {
      if (text.includes('pg_locks')) return { rows: [{ held: true }] }
      return healthyFence(8)(text, undefined)
    })
    const messages: unknown[] = []

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf' }) as never,
        createVcfMappedStream: async () => Readable.from([]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'ws',
        mode: 'single-file',
        caseName: 'superseded',
        filePath: '/tmp/a.vcf',
        lease: { holderPid: 4242, generation: 7 }
      },
      (message) => messages.push(message)
    )

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'CONFLICT',
        message: expect.stringMatching(/superseded/i)
      })
    ])
    expect(texts.some((text) => /INSERT|UPDATE|DELETE|COPY/.test(text))).toBe(false)
  })

  it('reports a cleanup that recovery took over as the typed conflict, not as a cleanup failure', async () => {
    // The file fails for its own reason; by then a new owner has recovered
    // the workspace, so the worker's cleanup of its rows is refused.
    let generation = 7
    const { client } = recordingClient((text) => {
      if (text.includes('pg_locks')) return { rows: [{ held: true }] }
      if (text.startsWith('INSERT') && text.includes('"cases_all"')) return { rows: [{ id: '5' }] }
      return healthyFence(generation)(text, undefined)
    })
    const messages: unknown[] = []

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf' }) as never,
        // Fails before the first row.
        createVcfMappedStream: async () =>
          ({
            [Symbol.asyncIterator]: () => ({
              next: async () => {
                generation = 8
                throw new Error('unreadable file')
              }
            })
          }) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'ws',
        mode: 'multi-file',
        caseName: 'taken-over',
        files: [
          { filePath: '/tmp/a.vcf', variantType: 'snv-indel', annotationFormat: null, caller: null }
        ],
        lease: { holderPid: 4242, generation: 7 }
      },
      (message) => messages.push(message)
    )

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'CONFLICT',
        message: expect.stringMatching(/superseded/i)
      })
    ])
  })
})
