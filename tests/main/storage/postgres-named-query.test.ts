import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  runNamed,
  runNamedDynamic,
  schemaToken
} from '../../../src/main/storage/postgres/named-query'

describe('schemaToken — Sprint A B1 (Pass-3 MED #4)', () => {
  it('always appends the hash6 tail', () => {
    expect(schemaToken('public')).toMatch(/^public_[0-9a-f]{6}$/)
  })

  it('disambiguates Case Lab vs case-lab vs case_lab', () => {
    const a = schemaToken('Case Lab')
    const b = schemaToken('case-lab')
    const c = schemaToken('case_lab')
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
  })

  it('accepts quoted/weird schema names without producing PG-illegal identifiers', () => {
    const t = schemaToken('"weird-schema"')
    expect(t).toMatch(/^[a-z0-9_]+_[0-9a-f]{6}$/)
  })

  it('caps slug to 24 chars before the hash', () => {
    const longSchema = 'a'.repeat(100)
    const t = schemaToken(longSchema)
    // slug 24 + '_' + hash6 = 31 chars
    expect(t.length).toBe(31)
  })
})

describe('runNamed — Sprint A B1', () => {
  it('builds effective name as `${name}@${schemaToken}`', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool

    await runNamed(pool, {
      name: 'variants:query:v1',
      text: 'SELECT 1',
      values: [],
      schema: 'public'
    })

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^variants:query:v1@public_[0-9a-f]{6}$/),
        text: 'SELECT 1',
        values: []
      })
    )
  })

  it('forbids "@" in logical name', async () => {
    const pool = { query: vi.fn() } as unknown as Pool
    await expect(
      runNamed(pool, {
        name: 'variants:bad@name',
        text: 'SELECT 1',
        values: [],
        schema: 'public'
      })
    ).rejects.toThrow(/logical name.*must not contain.*@/i)
  })

  it('retries unnamed on PG error 26000 (Pass-6 MED-LOW #5 server-side path)', async () => {
    let call = 0
    const queryMock = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        const err = new Error('prepared statement does not exist') as Error & { code: string }
        err.code = '26000'
        throw err
      }
      return { rows: [{ ok: true }], rowCount: 1 }
    })
    const pool = { query: queryMock } as unknown as Pool

    const result = await runNamed(pool, {
      name: 'foo:bar:v1',
      text: 'SELECT 1',
      values: [],
      schema: 'public'
    })

    expect(call).toBe(2)
    expect(queryMock.mock.calls[1][0]).not.toHaveProperty('name')
    expect(result.rows[0]).toEqual({ ok: true })
  })

  it('retries unnamed on PG error 42704 (Gate 7 — undefined_object alternate path)', async () => {
    let call = 0
    const queryMock = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) {
        const err = new Error('prepared statement "foo" does not exist') as Error & {
          code: string
        }
        err.code = '42704'
        throw err
      }
      return { rows: [{ ok: true }], rowCount: 1 }
    })
    const pool = { query: queryMock } as unknown as Pool

    const result = await runNamed(pool, {
      name: 'foo:bar:v1',
      text: 'SELECT 1',
      values: [],
      schema: 'public'
    })

    expect(call).toBe(2)
    expect(queryMock.mock.calls[1][0]).not.toHaveProperty('name')
    expect(result.rows[0]).toEqual({ ok: true })
  })

  it('does NOT swallow client-side "Prepared statements must be unique"', async () => {
    const queryMock = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Prepared statements must be unique - 'foo:bar:v1@public_abc123' was used for a different statement"
        )
      )
    const pool = { query: queryMock } as unknown as Pool

    await expect(
      runNamed(pool, { name: 'foo:bar:v1', text: 'SELECT 1', values: [], schema: 'public' })
    ).rejects.toThrow(/Prepared statements must be unique/i)
    expect(queryMock).toHaveBeenCalledOnce() // no retry on client-side error
  })
})

describe('runNamedDynamic — Sprint A B1 (Pass-8 #3)', () => {
  it('appends a :t<sha1-8> tail to the base name', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool

    await runNamedDynamic(pool, {
      baseName: 'variants:queryVariants',
      text: 'SELECT * FROM variants WHERE id = $1',
      values: [1],
      schema: 'public'
    })

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^variants:queryVariants:t[0-9a-f]{8}@public_[0-9a-f]{6}$/),
        text: 'SELECT * FROM variants WHERE id = $1'
      })
    )
  })

  it('produces distinct effective names for distinct SQL text', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool

    await runNamedDynamic(pool, {
      baseName: 'q',
      text: 'SELECT 1',
      values: [],
      schema: 'public'
    })
    await runNamedDynamic(pool, {
      baseName: 'q',
      text: 'SELECT 2',
      values: [],
      schema: 'public'
    })
    const n1 = queryMock.mock.calls[0][0].name as string
    const n2 = queryMock.mock.calls[1][0].name as string
    expect(n1).not.toBe(n2)
  })

  it('falls back to unnamed once the effective-name cap is exceeded (Pass-9 #2)', async () => {
    // Implementation detail: cap is process-level, configurable via a test-only
    // setter exposed by the module (e.g. __setCapForTests(n)). Set a small cap
    // and overflow it.
    const { __setCapForTests, __resetCapForTests } =
      await import('../../../src/main/storage/postgres/named-query')
    // Clear the module-level seenDynamicNames set so this test exercises the
    // documented "first N named, rest unnamed" contract against a clean set
    // (the set is module-level and is NOT reset by vi.clearAllMocks).
    __resetCapForTests()
    __setCapForTests(2)
    try {
      const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      const pool = { query: queryMock } as unknown as Pool
      for (let i = 0; i < 5; i++) {
        await runNamedDynamic(pool, {
          baseName: 'q',
          text: `SELECT ${i}`,
          values: [],
          schema: 'public'
        })
      }
      // First two calls are named; remaining fall back to unnamed.
      const namedCalls = queryMock.mock.calls.filter((c) => c[0].name).length
      expect(namedCalls).toBe(2)
    } finally {
      __resetCapForTests()
    }
  })
})

describe('effective statement names fit PostgreSQL identifiers (NAMEDATALEN 64)', () => {
  // PostgreSQL silently truncates prepared-statement names to 63 bytes, so
  // two names that only differ past byte 63 collide on the server
  // ("prepared statement ... already exists").
  const schemaA = `${'tenant_workspace_'.repeat(3)}aaaaaaaaa`
  const schemaB = `${'tenant_workspace_'.repeat(3)}bbbbbbbbb`
  const longName = 'cohort_summary:annotation_flags_on_case_delete:v1'

  async function effectiveName(
    kind: 'static' | 'dynamic',
    name: string,
    schema: string,
    text = 'SELECT 1'
  ): Promise<string> {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const pool = { query: queryMock } as unknown as Pool
    if (kind === 'static') await runNamed(pool, { name, text, values: [], schema })
    else await runNamedDynamic(pool, { baseName: name, text, values: [], schema })
    return queryMock.mock.calls[0][0].name as string
  }

  it('uses 60-char schema names', () => {
    expect(schemaA).toHaveLength(60)
    expect(schemaB).toHaveLength(60)
  })

  it.each(['static', 'dynamic'] as const)(
    '%s: keeps every effective name within 63 bytes',
    async (kind) => {
      const n = await effectiveName(kind, longName, schemaA)
      expect(Buffer.byteLength(n)).toBeLessThanOrEqual(63)
    }
  )

  it.each(['static', 'dynamic'] as const)(
    '%s: distinct schemas never share a name, even when the readable part is truncated',
    async (kind) => {
      const a = await effectiveName(kind, longName, schemaA)
      const b = await effectiveName(kind, longName, schemaB)
      expect(a.slice(0, 63)).not.toBe(b.slice(0, 63))
    }
  )

  it('dynamic: distinct SQL text keeps distinct names under truncation', async () => {
    const base = 'cohort:queryVariants:summary_page_with_annotation_flags'
    const a = await effectiveName('dynamic', base, schemaA, 'SELECT 1')
    const b = await effectiveName('dynamic', base, schemaA, 'SELECT 2')
    expect(a.slice(0, 63)).not.toBe(b.slice(0, 63))
  })

  it('is deterministic for the same logical name and schema', async () => {
    expect(await effectiveName('static', longName, schemaA)).toBe(
      await effectiveName('static', longName, schemaA)
    )
  })
})
