import { describe, expect, it } from 'vitest'

import {
  buildPostgresConnectionLabel,
  buildPostgresPoolConfig,
  getPostgresStorageConfig,
  redactPostgresConnectionUrl
} from '../../../src/main/storage/config'

describe('getPostgresStorageConfig', () => {
  it('returns null when postgres env is absent', () => {
    expect(getPostgresStorageConfig({})).toBeNull()
  })

  it('returns normalized defaults for schema, application name, timeouts, and pool size', () => {
    expect(
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev'
      })
    ).toEqual({
      url: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      schema: 'public',
      applicationName: 'varlens-main',
      sslMode: 'disable',
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 30000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 10000,
      poolMax: 4
    })
  })

  it('rejects an invalid ssl mode', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SSL_MODE: 'bogus'
      })
    ).toThrow('Invalid VARLENS_PG_SSL_MODE')
  })

  it('rejects a malformed postgres url with a var-specific error', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'not a url'
      })
    ).toThrow('VARLENS_PG_URL')
  })

  it('rejects non-postgres url schemes early', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'https://example.com/not-postgres'
      })
    ).toThrow('VARLENS_PG_URL')
  })

  it('rejects a blank schema after trimming', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: '   '
      })
    ).toThrow('VARLENS_PG_SCHEMA')
  })

  it('rejects invalid numeric timeout values', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_QUERY_TIMEOUT_MS: '-1'
      })
    ).toThrow('VARLENS_PG_QUERY_TIMEOUT_MS')
  })

  it.each([
    ['VARLENS_PG_QUERY_TIMEOUT_MS', '1.5'],
    ['VARLENS_PG_QUERY_TIMEOUT_MS', '10ms'],
    ['VARLENS_PG_QUERY_TIMEOUT_MS', '1e3'],
    ['VARLENS_PG_POOL_MAX', '2.5']
  ])('rejects malformed integer env values for %s=%s', (envName, value) => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        [envName]: value
      })
    ).toThrow(envName)
  })

  it('rejects pool sizes smaller than 1', () => {
    expect(() =>
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_POOL_MAX: '0'
      })
    ).toThrow('VARLENS_PG_POOL_MAX')
  })
})

describe('redactPostgresConnectionUrl', () => {
  it('removes credentials while preserving the target database', () => {
    expect(
      redactPostgresConnectionUrl('postgres://varlens:secret@127.0.0.1:55432/varlens_dev')
    ).toBe('postgres://127.0.0.1:55432/varlens_dev')
  })

  it('removes query parameters from the redacted url', () => {
    expect(
      redactPostgresConnectionUrl(
        'postgres://varlens:secret@127.0.0.1:55432/varlens_dev?application_name=foo&sslmode=require'
      )
    ).toBe('postgres://127.0.0.1:55432/varlens_dev')
  })
})

describe('buildPostgresConnectionLabel', () => {
  it('formats host, port, database, and schema', () => {
    expect(buildPostgresConnectionLabel('postgres://127.0.0.1:55432/varlens_dev', 'public')).toBe(
      '127.0.0.1:55432/varlens_dev (public)'
    )
  })
})

describe('buildPostgresPoolConfig', () => {
  it('maps normalized config into pg pool options without search_path mutation', () => {
    const config = getPostgresStorageConfig({
      VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      VARLENS_PG_SCHEMA: 'varlens'
    })

    expect(buildPostgresPoolConfig(config!)).toMatchObject({
      connectionString: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      application_name: 'varlens-main',
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 10000,
      max: 4
    })
  })

  it('maps ssl mode require into a pool ssl object', () => {
    const config = getPostgresStorageConfig({
      VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      VARLENS_PG_SSL_MODE: 'require'
    })

    expect(buildPostgresPoolConfig(config!)).toMatchObject({
      ssl: {
        rejectUnauthorized: true
      }
    })
  })

  it('rejects ssl mode prefer until fallback semantics are implemented correctly', () => {
    const config = getPostgresStorageConfig({
      VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      VARLENS_PG_SSL_MODE: 'prefer'
    })

    expect(() => buildPostgresPoolConfig(config!)).toThrow('VARLENS_PG_SSL_MODE=prefer')
  })
})
