import type { Pool } from 'pg'

import type { PostgresHealthDiagnosticResult } from '../../../shared/types/postgres-profile'
import { quoteIdentifier } from './identifiers'

export type { PostgresHealthDiagnosticResult }

const POSTGRES_FAILURE_MESSAGES: Record<string, string> = {
  '28P01': 'PostgreSQL authentication failed. Check the username and password for this profile.',
  '3D000': 'PostgreSQL database does not exist. Check the configured database name.',
  '42501':
    'PostgreSQL user has insufficient privilege. Check the role grants for this database and schema.',
  '3F000': 'PostgreSQL schema does not exist. Check the configured schema name.'
}

const CONNECTION_UNAVAILABLE_MESSAGE =
  'PostgreSQL connection unavailable. Check the host, port, network, and server availability.'

const CONNECTION_UNAVAILABLE_CODES = new Set([
  'CONNECTION_TIMEOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT'
])

export class PostgresHealthDiagnostics {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async collect(): Promise<PostgresHealthDiagnosticResult> {
    try {
      const [version, user, migrationRelation, readProbe, writeProbe] = await Promise.all([
        this.pool.query('SELECT version() AS version'),
        this.pool.query('SELECT current_user'),
        this.pool.query(`SELECT to_regclass($1) AS relation`, [
          `${this.schemaName}."schema_migrations"`
        ]),
        this.pool.query(
          `SELECT has_schema_privilege(current_user, $1, 'USAGE') AS can_read_schema`,
          [this.schema]
        ),
        this.pool.query(
          `SELECT has_schema_privilege(current_user, $1, 'CREATE') AS can_write_schema`,
          [this.schema]
        )
      ])
      const migration =
        migrationRelation.rows[0]?.relation === null
          ? { rows: [] }
          : await this.pool.query(
              `SELECT version FROM ${this.schemaName}."schema_migrations" ORDER BY version DESC LIMIT 1`
            )

      return {
        ok: true,
        serverVersion: String(version.rows[0]?.version ?? ''),
        currentUser: String(user.rows[0]?.current_user ?? ''),
        schema: this.schema,
        currentMigration: (migration.rows[0]?.version as string | undefined) ?? null,
        canReadSchema: Boolean(readProbe.rows[0]?.can_read_schema),
        canWriteSchema: Boolean(writeProbe.rows[0]?.can_write_schema)
      }
    } catch (error) {
      return {
        ok: false,
        schema: this.schema,
        message: classifyPostgresFailureMessage(error)
      }
    }
  }
}

export function classifyPostgresFailureMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code !== undefined) {
    const message = POSTGRES_FAILURE_MESSAGES[code]
    if (message !== undefined) {
      return message
    }

    if (CONNECTION_UNAVAILABLE_CODES.has(code)) {
      return CONNECTION_UNAVAILABLE_MESSAGE
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (isConnectionUnavailableMessage(message)) {
    return CONNECTION_UNAVAILABLE_MESSAGE
  }

  return redactPostgresFailureMessage(message)
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isConnectionUnavailableMessage(message: string): boolean {
  return /connection (?:timed out|timeout)|timeout exceeded|getaddrinfo|enotfound|eai_again|econnrefused|etimedout/i.test(
    message
  )
}

function redactPostgresFailureMessage(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted PostgreSQL connection URL]')
    .replace(/password\s*=\s*([^\s;]+)/gi, 'password=[redacted]')
    .replace(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gi,
      '[redacted CA certificate]'
    )
}
