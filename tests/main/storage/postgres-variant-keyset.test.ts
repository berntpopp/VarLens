import { describe, expect, it, vi } from 'vitest'

import {
  buildPostgresVariantOrderTerms,
  decodeVariantCursor,
  encodeVariantCursor,
  keysetPredicate,
  keysetScope,
  orderTermsToSql,
  planKeyset
} from '../../../src/main/storage/postgres/postgres-variant-order'
import { PostgresVariantReadRepository } from '../../../src/main/storage/postgres/PostgresVariantReadRepository'
import { chrRankSql } from '../../../src/shared/sql/chromosome-order'

const RANK = chrRankSql('v.chr')

const SORT_COLUMNS = { chr: 'v.chr', pos: 'v.pos', gene_symbol: 'v.gene_symbol', id: 'v.id' }

describe('postgres variant ORDER BY terms', () => {
  it('keeps the genomic default order with an id tiebreaker', () => {
    const terms = buildPostgresVariantOrderTerms(undefined, SORT_COLUMNS)
    expect(orderTermsToSql(terms)).toBe(
      `ORDER BY ${RANK} ASC, v.chr COLLATE "C" ASC, v.pos ASC, v.id ASC`
    )
  })

  it('maps user sorts with NULLS LAST and drops unknown keys', () => {
    const terms = buildPostgresVariantOrderTerms(
      [
        { key: 'gene_symbol', order: 'desc' },
        { key: 'bogus', order: 'asc' }
      ],
      SORT_COLUMNS
    )
    expect(orderTermsToSql(terms)).toBe('ORDER BY v.gene_symbol DESC NULLS LAST, v.id ASC')
  })
})

describe('planKeyset', () => {
  it('accepts ascending orders over NOT NULL columns', () => {
    expect(planKeyset(buildPostgresVariantOrderTerms(undefined, SORT_COLUMNS))?.signature).toBe(
      `${RANK},v.chr COLLATE "C",v.pos,v.id`
    )
    expect(
      planKeyset(buildPostgresVariantOrderTerms([{ key: 'pos', order: 'asc' }], SORT_COLUMNS))
        ?.signature
    ).toBe('v.pos,v.id')
  })

  it('falls back (null) for nullable columns or descending sorts', () => {
    expect(
      planKeyset(
        buildPostgresVariantOrderTerms([{ key: 'gene_symbol', order: 'asc' }], SORT_COLUMNS)
      )
    ).toBeNull()
    expect(
      planKeyset(buildPostgresVariantOrderTerms([{ key: 'pos', order: 'desc' }], SORT_COLUMNS))
    ).toBeNull()
  })
})

describe('variant cursors', () => {
  const plan = planKeyset(buildPostgresVariantOrderTerms(undefined, SORT_COLUMNS))!
  const scope = keysetScope(plan, { case_id: 1 })

  it('round-trips the seek values of the last row', () => {
    const cursor = encodeVariantCursor(plan, scope, { chr: '1', pos: '12345', id: 99 })!
    expect(decodeVariantCursor(plan, scope, cursor)).toEqual(['1', '1', '12345', 99])
  })

  it('rejects cursors from another filter, a tampered payload or garbage', () => {
    const cursor = encodeVariantCursor(plan, scope, { chr: '1', pos: 5, id: 9 })!
    expect(decodeVariantCursor(plan, keysetScope(plan, { case_id: 2 }), cursor)).toBeNull()
    const tampered = Buffer.from(
      JSON.stringify({ v: 2, s: scope, k: ['1', '1', 'DROP TABLE', 9] })
    ).toString('base64url')
    expect(decodeVariantCursor(plan, scope, tampered)).toBeNull()
    expect(decodeVariantCursor(plan, scope, 'not-base64-json')).toBeNull()
    expect(decodeVariantCursor(plan, scope, 'x'.repeat(2000))).toBeNull()
  })

  it('builds a typed row-value predicate with bound parameters only', () => {
    const params: unknown[] = []
    const sql = keysetPredicate(plan, ['X', 'X', 7, 3], (value) => {
      params.push(value)
      return `$${params.length + 4}`
    })
    expect(sql).toBe(
      `(${RANK}, v.chr COLLATE "C", v.pos, v.id) > (${chrRankSql('kp').split('kp').join('$5::text')}, $6::text COLLATE "C", $7::bigint, $8::bigint)`
    )
    expect(params).toEqual(['X', 'X', 7, 3])
  })
})

describe('PostgresVariantReadRepository keyset paging', () => {
  function makePool(rows: Array<Record<string, unknown>>) {
    return {
      query: vi.fn(async (arg: { text?: string } | string) => {
        const text = typeof arg === 'string' ? arg : (arg.text ?? '')
        return text.includes('LIMIT $') ? { rows } : { rows: [{ count: 3 }] }
      })
    }
  }

  it('returns next_cursor only when the client opts in and the page is full', async () => {
    const rows = [
      { id: '1', chr: '1', pos: '10' },
      { id: '2', chr: '1', pos: '20' }
    ]
    const repo = new PostgresVariantReadRepository(makePool(rows) as never, 'public')

    const plain = await repo.queryVariants({ case_id: 1 }, 2, 0)
    expect(plain.next_cursor).toBeUndefined()

    const optedIn = await repo.queryVariants({ case_id: 1 }, 2, 0, undefined, false, false, {})
    expect(optedIn.next_cursor).toEqual(expect.any(String))
    expect(optedIn.paging).toBeUndefined()

    const shortPage = await repo.queryVariants({ case_id: 1 }, 5, 0, undefined, false, false, {})
    expect(shortPage.next_cursor).toBeUndefined()
  })

  it('seeks with a row-value predicate and OFFSET 0 when given a valid cursor', async () => {
    const pool = makePool([{ id: '3', chr: '2', pos: '5' }])
    const repo = new PostgresVariantReadRepository(pool as never, 'public')
    const first = await repo.queryVariants({ case_id: 1 }, 1, 0, undefined, true, false, {})

    const second = await repo.queryVariants({ case_id: 1 }, 1, 1, undefined, true, false, {
      cursor: first.next_cursor
    })

    expect(second.paging).toBe('keyset')
    const call = pool.query.mock.calls.at(-1)![0] as { text: string; values: unknown[] }
    expect(call.text).toContain(`AND (${RANK}, v.chr COLLATE "C", v.pos, v.id) > (`)
    expect(call.text).toContain('$3::text COLLATE "C", $4::bigint, $5::bigint)')
    expect(call.values).toEqual([1, '2', '2', '5', '3', 1, 0])
  })

  it('ignores a cursor for a non-keyset sort and uses OFFSET', async () => {
    const pool = makePool([{ id: '3', chr: '2', pos: '5' }])
    const repo = new PostgresVariantReadRepository(pool as never, 'public')
    const result = await repo.queryVariants(
      { case_id: 1 },
      1,
      40,
      [{ key: 'gene_symbol', order: 'asc' }],
      true,
      false,
      { cursor: 'anything' }
    )
    expect(result.paging).toBeUndefined()
    expect(result.next_cursor).toBeUndefined()
    const call = pool.query.mock.calls.at(-1)![0] as { values: unknown[] }
    expect(call.values.slice(-2)).toEqual([1, 40])
  })
})
