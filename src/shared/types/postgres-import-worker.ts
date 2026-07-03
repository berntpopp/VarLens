import type { ClientConfig } from 'pg'
import type { MultiFileImportSpec } from './api'

/**
 * Standard cancellation message produced by the postgres import worker
 * when the user cancels an in-flight import. Both the worker (sender)
 * and the executor (receiver, for routing logic) import this so the
 * string is the same on both sides.
 */
export const POSTGRES_IMPORT_CANCELLATION_MESSAGE = 'Import cancelled by user'

/**
 * pg.Client config plumbed from main to worker. Mirrors the connection-relevant
 * fields of buildPostgresPoolConfig minus pool-only fields. SSL is serialized
 * as a discriminated descriptor since `tls.SecureContextOptions` does not
 * round-trip through structuredClone.
 */
export interface PostgresClientConfig {
  connectionString: string
  application_name?: string
  connectionTimeoutMillis?: number
  statement_timeout?: number
  query_timeout?: number
  lock_timeout?: number
  idle_in_transaction_session_timeout?: number
  keepAlive?: boolean
  /**
   * Discriminated SSL descriptor — structuredClone-safe at the worker boundary.
   * Cert/key/ca material is intentionally not supported here; pass it via the
   * connection string or PG environment variables (PGSSLCERT, PGSSLKEY, PGSSLROOTCERT)
   * which pg consumes natively.
   */
  ssl?: { mode: 'disable' } | { mode: 'require'; rejectUnauthorized: boolean }
}

/**
 * Inbound start message. The interface is intentionally wide — single-file and
 * multi-file modes share most fields, and the worker only ever receives one
 * message per invocation. Field validity per mode:
 *   - single-file: filePath required; format optional (worker auto-detects);
 *     files/filters/batchSize/throttleMs ignored
 *   - multi-file: files required (non-empty); filters optional; filePath/format
 *     ignored
 * The worker validates the right combination at runtime in Task 6/11.
 */
export interface PostgresImportWorkerStartMessage {
  type: 'start'
  client: PostgresClientConfig
  schema: string
  mode: 'single-file' | 'multi-file'
  caseName: string
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  // Single-file:
  filePath?: string
  /**
   * Advisory format hint. The worker always re-detects via detectFormat()
   * because JSON variants (simple/object/columnar) need caseKey + wrapped
   * data that a bare hint cannot supply. Callers may pass it for symmetry
   * with the file-extension-based hint pipeline, but the worker does not
   * short-circuit on it.
   */
  format?: 'json' | 'vcf'
  // Multi-file:
  files?: MultiFileImportSpec[]
  filters?: {
    bedFilePath?: string | null
    bedPadding?: number
    passOnly?: boolean
    minQual?: number | null
    minGq?: number | null
    minDp?: number | null
  }
  batchSize?: number
  throttleMs?: number
}

export interface PostgresImportWorkerCancelMessage {
  type: 'cancel'
}

export type PostgresImportWorkerInboundMessage =
  PostgresImportWorkerStartMessage | PostgresImportWorkerCancelMessage

export interface PostgresImportWorkerProgressMessage {
  type: 'progress'
  phase: 'parsing' | 'inserting' | 'finalizing'
  rowsProcessed: number
  rowsTotal?: number
  filePath?: string
}

export interface PostgresImportWorkerFileCompleteMessage {
  type: 'file-complete'
  filePath: string
  caseId: number
  variantCount: number
}

export interface PostgresImportWorkerCompleteMessage {
  type: 'complete'
  // Discriminated by the start mode.
  mode: 'single-file' | 'multi-file'
  result: {
    caseId: number
    variantCount: number
    /** Present and non-empty only when the matching start message had `mode === 'multi-file'`. */
    files?: Array<{
      filePath: string
      variantType: string
      variantCount: number
      error?: string
    }>
    skipped: number
    errors: string[]
    elapsed: number
  }
}

export interface PostgresImportWorkerErrorMessage {
  type: 'error'
  message: string
  cause?: string
}

export type PostgresImportWorkerOutboundMessage =
  | PostgresImportWorkerProgressMessage
  | PostgresImportWorkerFileCompleteMessage
  | PostgresImportWorkerCompleteMessage
  | PostgresImportWorkerErrorMessage

/**
 * Helper to convert the runtime `ClientConfig` produced by `buildPostgresClientConfig`
 * into the structured-clone-safe `PostgresClientConfig` for the start message.
 */
export function toPostgresClientConfigMessage(
  client: ClientConfig & { connectionString: string }
): PostgresClientConfig {
  let ssl: PostgresClientConfig['ssl']
  if (client.ssl === undefined) {
    ssl = { mode: 'disable' }
  } else if (client.ssl === false) {
    ssl = { mode: 'disable' }
  } else if (client.ssl === true) {
    // pg's boolean shorthand: true means "require SSL, trust all certs"
    // (i.e. the equivalent of `{ rejectUnauthorized: false }`).
    ssl = { mode: 'require', rejectUnauthorized: false }
  } else if (typeof client.ssl === 'object' && 'rejectUnauthorized' in client.ssl) {
    ssl = { mode: 'require', rejectUnauthorized: Boolean(client.ssl.rejectUnauthorized) }
  } else {
    // Unknown shape (e.g. cert/key/ca buffers). Silently downgrading to
    // `disable` would mask a real SSL configuration error, so refuse to
    // serialize and tell the caller how to express cert material in a
    // worker-safe way.
    throw new Error(
      'Unsupported postgres ssl configuration for worker serialization. ' +
        'SSL cert/key/ca material must be provided via the connection string or ' +
        'PG environment variables (PGSSLCERT, PGSSLKEY, PGSSLROOTCERT) — ' +
        'these are consumed by pg natively and survive the structuredClone boundary.'
    )
  }
  return {
    connectionString: client.connectionString,
    application_name: client.application_name,
    connectionTimeoutMillis: client.connectionTimeoutMillis,
    statement_timeout:
      typeof client.statement_timeout === 'number' ? client.statement_timeout : undefined,
    query_timeout: typeof client.query_timeout === 'number' ? client.query_timeout : undefined,
    lock_timeout: typeof client.lock_timeout === 'number' ? client.lock_timeout : undefined,
    idle_in_transaction_session_timeout:
      typeof client.idle_in_transaction_session_timeout === 'number'
        ? client.idle_in_transaction_session_timeout
        : undefined,
    keepAlive: client.keepAlive,
    ssl
  }
}
