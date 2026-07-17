import type { Pool } from 'pg'

import type { UserRole } from '../../shared/auth/auth-constants'

const DISABLED_LOCAL_PASSWORD_HASH = 'platform-identity-disabled-local-password'

interface PostgresError extends Error {
  code?: string
  constraint?: string
}

function quoteSchema(schema: string): string {
  return `"${schema.replace(/"/g, '""')}"`
}

export class PostgresPlatformUserStore {
  private readonly schemaQuoted: string

  constructor(
    private readonly pool: Pool,
    schema: string
  ) {
    this.schemaQuoted = quoteSchema(schema)
  }

  async upsert(input: {
    subject: string
    displayName: string
    role: UserRole
  }): Promise<{ id: number; subject: string; role: UserRole }> {
    let result
    try {
      result = await this.pool.query<{ id: string; username: string; role: UserRole }>(
        `INSERT INTO ${this.schemaQuoted}."users" AS platform_target
          (username, display_name, password_hash, role, must_change_password, is_active,
           password_changed_at, auth_source)
         VALUES ($1, $2, $3, $4, FALSE, TRUE, now(), 'platform')
         ON CONFLICT (username)
         DO UPDATE SET
            display_name = EXCLUDED.display_name,
            role = EXCLUDED.role,
            is_active = TRUE,
            must_change_password = FALSE,
            updated_at = now()
         WHERE platform_target.auth_source = 'platform'
           AND platform_target.password_hash = $5
         RETURNING id, username, role`,
        [
          input.subject,
          input.displayName,
          DISABLED_LOCAL_PASSWORD_HASH,
          input.role,
          DISABLED_LOCAL_PASSWORD_HASH
        ]
      )
    } catch (error) {
      const postgresError = error as PostgresError
      if (
        postgresError.code === '23505' &&
        postgresError.constraint === 'users_single_platform_identity'
      ) {
        throw new Error('VarLens instance is already bound to another platform subject', {
          cause: error
        })
      }
      throw error
    }
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Platform identity cannot overwrite local user: ${input.subject}`)
    }
    const row = result.rows[0]
    return { id: Number(row.id), subject: row.username, role: row.role }
  }
}
