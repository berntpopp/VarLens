import type { ClientConfig, PoolConfig } from 'pg'
import type {
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSecretInput
} from '../../shared/types/postgres-profile'

export type PostgresSslMode = 'disable' | 'prefer' | 'require'

export interface PostgresStorageConfig {
  url: string
  schema: string
  applicationName: string
  sslMode: PostgresSslMode
  caCertificatePem?: string
  connectionTimeoutMillis: number
  statementTimeoutMs: number
  queryTimeoutMs: number
  lockTimeoutMs: number
  idleInTransactionSessionTimeoutMs: number
  poolMax: number
}

const DEFAULT_PG_SCHEMA = 'public'
const DEFAULT_PG_APPLICATION_NAME = 'varlens-main'
const DEFAULT_PG_SSL_MODE: PostgresSslMode = 'disable'
const DEFAULT_PG_CONNECTION_TIMEOUT_MS = 5000
const DEFAULT_PG_STATEMENT_TIMEOUT_MS = 30000
const DEFAULT_PG_QUERY_TIMEOUT_MS = 30000
const DEFAULT_PG_LOCK_TIMEOUT_MS = 5000
const DEFAULT_PG_IDLE_IN_TX_TIMEOUT_MS = 10000
/**
 * Default pg.Pool size (`VARLENS_PG_POOL_MAX`). Raised from 4 after the
 * 2026-10 blocking audit (05-blocking-analysis.md, W-5): with 4 connections a
 * handful of concurrent aggregates or a long delete starved every other web
 * user at the pool, not the event loop. Size it against the server's
 * `max_connections` divided by the number of replicas (plus headroom for the
 * import worker, which opens its own client).
 */
export const DEFAULT_PG_POOL_MAX = 10

const URL_SSL_PARAMS = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/

function parsePostgresUrl(url: string): URL {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new Error(
      'VARLENS_PG_URL must be a valid PostgreSQL connection URL (for example, postgres://user:password@host:5432/database or postgresql://user:password@host:5432/database)'
    )
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('VARLENS_PG_URL must use the postgres: or postgresql: scheme')
  }

  return parsed
}

function parseNonNegativeInteger(
  value: string | undefined,
  envName: string,
  fallback: number
): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const normalized = value.trim()
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(normalized)) {
    throw new Error(`${envName} must be a non-negative integer`)
  }

  return Number(normalized)
}

function assertNoManagedSslConflict(url: string): void {
  const parsed = parsePostgresUrl(url)

  for (const param of URL_SSL_PARAMS) {
    if (parsed.searchParams.has(param)) {
      throw new Error(
        `VARLENS_PG_URL must not include ${param} when VarLens manages PostgreSQL SSL configuration`
      )
    }
  }
}

export function getPostgresStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresStorageConfig | null {
  const url = env.VARLENS_PG_URL?.trim()

  if (url === undefined || url === '') {
    return null
  }

  const schema = env.VARLENS_PG_SCHEMA?.trim() ?? DEFAULT_PG_SCHEMA
  if (schema === '') {
    throw new Error('VARLENS_PG_SCHEMA must not be blank')
  }

  const applicationNameRaw = env.VARLENS_PG_APPLICATION_NAME?.trim()
  const applicationName =
    applicationNameRaw === undefined || applicationNameRaw === ''
      ? DEFAULT_PG_APPLICATION_NAME
      : applicationNameRaw

  const sslModeRaw = env.VARLENS_PG_SSL_MODE?.trim()
  const sslMode = sslModeRaw === undefined || sslModeRaw === '' ? DEFAULT_PG_SSL_MODE : sslModeRaw
  if (sslMode !== 'disable' && sslMode !== 'prefer' && sslMode !== 'require') {
    throw new Error(`Invalid VARLENS_PG_SSL_MODE: ${sslMode}`)
  }

  assertNoManagedSslConflict(url)

  const connectionTimeoutMillis = parseNonNegativeInteger(
    env.VARLENS_PG_CONNECTION_TIMEOUT_MS,
    'VARLENS_PG_CONNECTION_TIMEOUT_MS',
    DEFAULT_PG_CONNECTION_TIMEOUT_MS
  )
  const statementTimeoutMs = parseNonNegativeInteger(
    env.VARLENS_PG_STATEMENT_TIMEOUT_MS,
    'VARLENS_PG_STATEMENT_TIMEOUT_MS',
    DEFAULT_PG_STATEMENT_TIMEOUT_MS
  )
  const queryTimeoutMs = parseNonNegativeInteger(
    env.VARLENS_PG_QUERY_TIMEOUT_MS,
    'VARLENS_PG_QUERY_TIMEOUT_MS',
    DEFAULT_PG_QUERY_TIMEOUT_MS
  )
  const lockTimeoutMs = parseNonNegativeInteger(
    env.VARLENS_PG_LOCK_TIMEOUT_MS,
    'VARLENS_PG_LOCK_TIMEOUT_MS',
    DEFAULT_PG_LOCK_TIMEOUT_MS
  )
  const idleInTransactionSessionTimeoutMs = parseNonNegativeInteger(
    env.VARLENS_PG_IDLE_IN_TX_TIMEOUT_MS,
    'VARLENS_PG_IDLE_IN_TX_TIMEOUT_MS',
    DEFAULT_PG_IDLE_IN_TX_TIMEOUT_MS
  )
  const poolMax = parseNonNegativeInteger(
    env.VARLENS_PG_POOL_MAX,
    'VARLENS_PG_POOL_MAX',
    DEFAULT_PG_POOL_MAX
  )

  if (poolMax < 1) {
    throw new Error('VARLENS_PG_POOL_MAX must be at least 1')
  }

  return {
    url,
    schema,
    applicationName,
    sslMode,
    connectionTimeoutMillis,
    statementTimeoutMs,
    queryTimeoutMs,
    lockTimeoutMs,
    idleInTransactionSessionTimeoutMs,
    poolMax
  }
}

export function redactPostgresConnectionUrl(url: string): string {
  const parsed = parsePostgresUrl(url)
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  return parsed.toString()
}

export function buildPostgresConnectionLabel(redactedUrl: string, schema: string): string {
  const parsed = new URL(redactedUrl)
  const databaseName = parsed.pathname.replace(/^\//, '') || '(no-db)'
  const port = parsed.port || '5432'

  return `${parsed.hostname}:${port}/${databaseName} (${schema})`
}

function buildPostgresSslConfig(
  config: Pick<PostgresStorageConfig, 'sslMode' | 'caCertificatePem'>
): ClientConfig['ssl'] {
  const { sslMode } = config
  if (sslMode === 'disable') {
    return undefined
  }

  if (sslMode === 'prefer') {
    throw new Error(
      'VARLENS_PG_SSL_MODE=prefer is not supported in Phase 2 because pg does not provide safe fallback semantics through this config path'
    )
  }

  return {
    rejectUnauthorized: true,
    ...(config.caCertificatePem !== undefined ? { ca: config.caCertificatePem } : {})
  }
}

export function buildPostgresClientConfig(config: PostgresStorageConfig): ClientConfig {
  return {
    connectionString: config.url,
    application_name: config.applicationName,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    idle_in_transaction_session_timeout: config.idleInTransactionSessionTimeoutMs,
    // TCP keepalive keeps long-running import connections alive across NAT
    // idle timeouts and other network middleboxes.
    keepAlive: true,
    ssl: buildPostgresSslConfig(config)
  }
}

export function buildPostgresPoolConfig(config: PostgresStorageConfig): PoolConfig {
  return {
    ...buildPostgresClientConfig(config),
    max: config.poolMax
  }
}

export function buildPostgresStorageConfigFromProfile(
  profile: PostgresConnectionProfilePublic,
  secrets: PostgresConnectionProfileSecretInput
): PostgresStorageConfig {
  const url = new URL('postgresql://localhost')
  url.hostname = profile.host
  url.port = String(profile.port)
  url.pathname = `/${profile.database}`
  url.username = profile.username
  url.password = secrets.password

  return {
    url: url.toString(),
    schema: profile.schema,
    applicationName: DEFAULT_PG_APPLICATION_NAME,
    sslMode: profile.sslMode === 'require-verify' ? 'require' : 'disable',
    ...(secrets.caCertificatePem !== undefined
      ? { caCertificatePem: secrets.caCertificatePem }
      : {}),
    connectionTimeoutMillis: profile.connectionTimeoutMillis,
    statementTimeoutMs: profile.statementTimeoutMs,
    queryTimeoutMs: profile.statementTimeoutMs,
    lockTimeoutMs: profile.lockTimeoutMs,
    idleInTransactionSessionTimeoutMs: profile.idleInTransactionSessionTimeoutMs,
    poolMax: profile.poolMax
  }
}
