import { describe, expect, it } from 'vitest'

import {
  buildPostgresClientConfig,
  buildPostgresConnectionLabel,
  buildPostgresPoolConfig,
  buildPostgresStorageConfigFromProfile,
  getPostgresStorageConfig,
  redactPostgresConnectionUrl
} from '../../../src/main/storage/config'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'

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
      poolMax: 10
    })
  })

  it('honours VARLENS_PG_POOL_MAX overrides', () => {
    expect(
      getPostgresStorageConfig({
        VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_POOL_MAX: '20'
      })?.poolMax
    ).toBe(20)
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
      max: 10
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

  it('enables keepAlive on the pg pool to survive long imports', () => {
    const config = getPostgresStorageConfig({
      VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev'
    })

    expect(buildPostgresPoolConfig(config!).keepAlive).toBe(true)
  })

  it('rejects ssl mode prefer until fallback semantics are implemented correctly', () => {
    const config = getPostgresStorageConfig({
      VARLENS_PG_URL: 'postgres://varlens:secret@127.0.0.1:55432/varlens_dev',
      VARLENS_PG_SSL_MODE: 'prefer'
    })

    expect(() => buildPostgresPoolConfig(config!)).toThrow('VARLENS_PG_SSL_MODE=prefer')
  })
})

describe('buildPostgresStorageConfigFromProfile', () => {
  it('builds a pg config with secret material only from the secret input', () => {
    const config = buildPostgresStorageConfigFromProfile(
      {
        id: 'profile-1',
        name: 'Lab PG',
        host: 'db.example.org',
        port: 5432,
        database: 'varlens',
        username: 'varlens_app',
        schema: 'workspace_a',
        sslMode: 'require-verify',
        poolMax: 3,
        connectionTimeoutMillis: 4000,
        statementTimeoutMs: 25000,
        lockTimeoutMs: 2000,
        idleInTransactionSessionTimeoutMs: 9000,
        caCertificateConfigured: true
      },
      { password: 'secret', caCertificatePem: 'pem' }
    )

    expect(config).toMatchObject({
      schema: 'workspace_a',
      sslMode: 'require',
      caCertificatePem: 'pem',
      poolMax: 3,
      connectionTimeoutMillis: 4000,
      statementTimeoutMs: 25000,
      queryTimeoutMs: 25000,
      lockTimeoutMs: 2000,
      idleInTransactionSessionTimeoutMs: 9000
    })
    expect(config.url).toContain('varlens_app:secret@db.example.org:5432/varlens')
  })
})

describe('buildPostgresClientConfig', () => {
  it('returns the same connection-related fields as buildPostgresPoolConfig minus pool-only fields', () => {
    const config: PostgresStorageConfig = {
      url: 'postgres://user:pw@127.0.0.1:5432/db',
      schema: 'public',
      applicationName: 'varlens-test',
      sslMode: 'disable',
      connectionTimeoutMillis: 1000,
      statementTimeoutMs: 60000,
      queryTimeoutMs: 60000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 30000,
      poolMax: 4
    }

    const pool = buildPostgresPoolConfig(config)
    const client = buildPostgresClientConfig(config)

    // Pool-only fields are absent.
    expect((client as Record<string, unknown>).max).toBeUndefined()

    // All connection fields match.
    expect(client.connectionString).toBe(pool.connectionString)
    expect(client.application_name).toBe(pool.application_name)
    expect(client.connectionTimeoutMillis).toBe(pool.connectionTimeoutMillis)
    expect(client.statement_timeout).toBe(pool.statement_timeout)
    expect(client.query_timeout).toBe(pool.query_timeout)
    expect(client.lock_timeout).toBe(pool.lock_timeout)
    expect(client.idle_in_transaction_session_timeout).toBe(
      pool.idle_in_transaction_session_timeout
    )
    expect(client.keepAlive).toBe(pool.keepAlive)
    expect(client.ssl).toEqual(pool.ssl)
  })
})
