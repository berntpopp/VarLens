/**
 * PostgresPlatformUserStore — platform-identity (hosted) user management for
 * the web variant.
 *
 * Split out of PostgresWebAuthService so the auth surface stays a focused
 * password/lockout/rotation module and the platform-identity provisioning
 * concerns (workspace adoption, hosted private-DB status mapping) live in
 * their own module. The two modules stay independent — each computes its own
 * quoted schema and shares nothing but the cross-backend auth constants.
 *
 * Web-only — never imported by the main process.
 */
import type { Pool, PoolClient } from 'pg'

import { ROLE_ADMIN, type UserRole } from '../../shared/auth/auth-constants'

export const PLATFORM_DISABLED_PASSWORD_HASH = 'platform-identity-disabled-local-password'
type PlatformPrivateDbStatus = 'pending' | 'active' | 'failed' | 'revoked'
type HostedPrivateDbStatus = 'unassigned' | 'active' | 'migration_failed' | 'disabled'

function hostedPrivateDbStatus(status: PlatformPrivateDbStatus | undefined): HostedPrivateDbStatus {
  if (status === 'active') return 'active'
  if (status === 'failed') return 'migration_failed'
  if (status === 'revoked') return 'disabled'
  return 'unassigned'
}

function quoteSchema(schema: string): string {
  // Defence against unsanitised schema names. Postgres identifiers
  // can be arbitrary unicode; the only safe quoting is doubling
  // embedded `"`. A schema with `"` in its name is pathological but
  // valid SQL — we handle it instead of refusing.
  return `"${schema.replace(/"/g, '""')}"`
}

export interface PostgresPlatformUserStoreOptions {
  pool: Pool
  schema: string
}

export class PostgresPlatformUserStore {
  private readonly pool: Pool
  private readonly schemaQuoted: string

  constructor(options: PostgresPlatformUserStoreOptions) {
    this.pool = options.pool
    this.schemaQuoted = quoteSchema(options.schema)
  }

  async assignPrivateDatabase(
    username: string,
    privateDbSecretRef: string,
    publicAnnotationSnapshotId?: string
  ): Promise<void> {
    const sch = this.schemaQuoted
    const result = await this.pool.query(
      `UPDATE ${sch}."users"
          SET private_db_secret_ref = $1,
              private_db_status = 'active',
              public_annotation_snapshot_id = $2,
              updated_at = now()
        WHERE username = $3 AND is_active = TRUE`,
      [privateDbSecretRef, publicAnnotationSnapshotId ?? null, username]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`User not found or inactive: ${username}`)
    }
  }

  async upsertPlatformUser(input: {
    username: string
    displayName: string
    role: UserRole
    privateDbSecretRef?: string
    privateDbStatus?: PlatformPrivateDbStatus
    publicAnnotationSnapshotId?: string
    /**
     * Operator-supplied intent to rebind a specific existing workspace holder
     * by its current username. Without it, adoption is only allowed when the
     * current holder is an unclaimed platform placeholder (see
     * adoptPlatformUserBySecretRef); an active local user is never silently
     * taken over.
     */
    expectedCurrentUsername?: string
  }): Promise<{ id: number; username: string; role: UserRole; private_db_status: string | null }> {
    const sch = this.schemaQuoted
    const privateDbStatus =
      input.privateDbSecretRef === undefined
        ? hostedPrivateDbStatus(undefined)
        : hostedPrivateDbStatus(input.privateDbStatus ?? 'active')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query<{ password_hash: string }>(
        `SELECT password_hash FROM ${sch}."users" WHERE username = $1 FOR UPDATE`,
        [input.username]
      )
      if (
        (existing.rowCount ?? 0) > 0 &&
        existing.rows[0].password_hash !== PLATFORM_DISABLED_PASSWORD_HASH
      ) {
        throw new Error(`Platform identity cannot overwrite local user: ${input.username}`)
      }

      if ((existing.rowCount ?? 0) === 0 && input.privateDbSecretRef !== undefined) {
        const adopted = await this.adoptPlatformUserBySecretRef(client, sch, input)
        if (adopted !== undefined) {
          await client.query('COMMIT')
          return adopted
        }
      }

      const result = await client.query<{
        id: string
        username: string
        role: UserRole
        private_db_status: string | null
      }>(
        `INSERT INTO ${sch}."users" AS platform_target
          (username, display_name, password_hash, role, must_change_password, is_active,
           private_db_secret_ref, private_db_status, public_annotation_snapshot_id, password_changed_at)
         VALUES ($1, $2, $3, $4, FALSE, TRUE, $5, $6, $7, now())
         ON CONFLICT (username)
         DO UPDATE SET
            display_name = EXCLUDED.display_name,
            role = EXCLUDED.role,
            is_active = TRUE,
            must_change_password = FALSE,
            private_db_secret_ref = EXCLUDED.private_db_secret_ref,
            private_db_status = EXCLUDED.private_db_status,
            public_annotation_snapshot_id = EXCLUDED.public_annotation_snapshot_id,
            updated_at = now()
         WHERE platform_target.password_hash = $8
         RETURNING id, username, role, private_db_status`,
        [
          input.username,
          input.displayName,
          PLATFORM_DISABLED_PASSWORD_HASH,
          input.role,
          input.privateDbSecretRef ?? null,
          privateDbStatus,
          input.publicAnnotationSnapshotId ?? null,
          PLATFORM_DISABLED_PASSWORD_HASH
        ]
      )
      if ((result.rowCount ?? 0) === 0) {
        throw new Error(`Platform identity cannot overwrite local user: ${input.username}`)
      }
      await client.query('COMMIT')
      const row = result.rows[0]
      return {
        id: Number(row.id),
        username: row.username,
        role: row.role,
        private_db_status: row.private_db_status
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async adoptPlatformUserBySecretRef(
    client: PoolClient,
    sch: string,
    input: {
      username: string
      displayName: string
      role: UserRole
      privateDbSecretRef: string
      privateDbStatus?: PlatformPrivateDbStatus
      publicAnnotationSnapshotId?: string
      expectedCurrentUsername?: string
    }
  ): Promise<
    { id: number; username: string; role: UserRole; private_db_status: string | null } | undefined
  > {
    const existing = await client.query<{
      id: string
      username: string
      role: UserRole
      password_hash: string
    }>(
      `SELECT id, username, role, password_hash
         FROM ${sch}."users"
        WHERE private_db_secret_ref = $1
        FOR UPDATE`,
      [input.privateDbSecretRef]
    )
    if ((existing.rowCount ?? 0) === 0) {
      return undefined
    }
    const current = existing.rows[0]
    if (current.role === ROLE_ADMIN) {
      throw new Error('Platform identity cannot adopt an admin user workspace')
    }
    // Only adopt a workspace whose current holder is an unclaimed platform
    // placeholder, unless the operator explicitly names the holder to rebind.
    // A real local user (any password hash other than the placeholder sentinel)
    // is never silently overwritten/renamed — that would be a cross-tenant
    // takeover. The caller wraps this in a transaction and ROLLBACKs on throw.
    const isAdoptablePlaceholder = current.password_hash === PLATFORM_DISABLED_PASSWORD_HASH
    const explicitIntentMatches =
      input.expectedCurrentUsername !== undefined &&
      input.expectedCurrentUsername === current.username
    if (!isAdoptablePlaceholder && !explicitIntentMatches) {
      throw new Error(
        `Platform identity refuses to adopt an active local workspace holder without explicit intent: ${current.username}`
      )
    }
    const result = await client.query<{
      id: string
      username: string
      role: UserRole
      private_db_status: string | null
    }>(
      `UPDATE ${sch}."users"
          SET username = $1,
              display_name = $2,
              password_hash = $3,
              role = $4,
              must_change_password = FALSE,
              is_active = TRUE,
              private_db_status = $5,
              public_annotation_snapshot_id = $6,
              password_changed_at = now(),
              updated_at = now()
        WHERE id = $7
       RETURNING id, username, role, private_db_status`,
      [
        input.username,
        input.displayName,
        PLATFORM_DISABLED_PASSWORD_HASH,
        input.role,
        hostedPrivateDbStatus(input.privateDbStatus ?? 'active'),
        input.publicAnnotationSnapshotId ?? null,
        current.id
      ]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Platform identity cannot adopt workspace user: ${current.username}`)
    }
    const row = result.rows[0]
    return {
      id: Number(row.id),
      username: row.username,
      role: row.role,
      private_db_status: row.private_db_status
    }
  }
}
