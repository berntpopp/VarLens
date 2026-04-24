import { describe, expect, it } from 'vitest'

import { quoteIdentifier } from '../../../src/main/storage/postgres/identifiers'

describe('postgres identifier helpers', () => {
  it('wraps identifiers in double quotes', () => {
    expect(quoteIdentifier('public')).toBe('"public"')
  })

  it('escapes embedded double quotes by doubling them', () => {
    expect(quoteIdentifier('tenant"schema')).toBe('"tenant""schema"')
  })
})
