import { describe, expect, it } from 'vitest'

import { getPostgresDevConfig } from '../../../src/main/storage/config'

describe('getPostgresDevConfig', () => {
  it('returns null when postgres env is absent', () => {
    expect(getPostgresDevConfig({})).toBeNull()
  })

  it('returns the configured url and default schema', () => {
    expect(getPostgresDevConfig({ VARLENS_PG_URL: 'postgres://x/y' })).toEqual({
      url: 'postgres://x/y',
      schema: 'public'
    })
  })
})
