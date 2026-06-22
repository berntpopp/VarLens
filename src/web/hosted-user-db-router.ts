import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { FastifyRequest } from 'fastify'

import { getPostgresStorageConfig } from '../main/storage/config'
import { openPostgresStorageSessionWithoutMigrating } from '../main/storage/postgres/createPostgresStorageSession'
import type { PostgresStorageSession } from '../main/storage/postgres/PostgresStorageSession'
import type { StorageSession } from '../main/storage/session'
import type { HostedWebDbTopology } from './topology'
import { assertSafeWorkspaceSecretRef } from './topology'
import type { PostgresWebAuthService } from './auth/PostgresWebAuthService'

export class HostedUserDbRouter {
  private readonly sessionsBySecretRef = new Map<
    string,
    {
      session: Promise<PostgresStorageSession>
      idleTimer: NodeJS.Timeout
    }
  >()

  constructor(
    private readonly options: {
      topology: HostedWebDbTopology
      authService: PostgresWebAuthService
    }
  ) {}

  async resolveSession(request: FastifyRequest): Promise<StorageSession> {
    const username = request.session?.user?.username
    if (username === undefined || username === '') {
      throw new Error('hosted private DB routing requires an authenticated user')
    }

    const user = await this.options.authService.getUser(username)
    if (user === undefined || user.is_active !== 1) {
      throw new Error(`hosted private DB routing user is inactive or missing: ${username}`)
    }
    if (user.private_db_status !== 'active') {
      throw new Error(`hosted private DB is not active for user: ${username}`)
    }
    const secretRef = user.private_db_secret_ref
    if (secretRef === undefined || secretRef === null || secretRef === '') {
      throw new Error(`hosted private DB secret ref is missing for user: ${username}`)
    }
    assertSafeWorkspaceSecretRef(secretRef)

    const existing = this.sessionsBySecretRef.get(secretRef)
    if (existing !== undefined) {
      clearTimeout(existing.idleTimer)
      existing.idleTimer = this.scheduleIdleClose(secretRef, existing.session)
      return existing.session
    }
    if (this.sessionsBySecretRef.size >= this.options.topology.pools.workspacePoolGlobalMax) {
      throw new Error('hosted private DB pool limit reached')
    }

    const created = this.openSession(secretRef)
    this.sessionsBySecretRef.set(secretRef, {
      session: created,
      idleTimer: this.scheduleIdleClose(secretRef, created)
    })
    try {
      return await created
    } catch (error) {
      this.sessionsBySecretRef.delete(secretRef)
      throw error
    }
  }

  async close(): Promise<void> {
    const entries = [...this.sessionsBySecretRef.values()]
    this.sessionsBySecretRef.clear()
    for (const entry of entries) {
      clearTimeout(entry.idleTimer)
    }
    const sessions = await Promise.allSettled(entries.map((entry) => entry.session))
    await Promise.all(
      sessions.map(async (result) => {
        if (result.status === 'fulfilled') {
          await result.value.close()
        }
      })
    )
  }

  private async openSession(secretRef: string): Promise<PostgresStorageSession> {
    const url = (await readFile(join(this.options.topology.workspaceSecretDir, secretRef), 'utf8')).trim()
    if (url === '') {
      throw new Error(`hosted private DB secret file is empty: ${secretRef}`)
    }
    const config = getPostgresStorageConfig({
      ...process.env,
      VARLENS_PG_URL: url,
      VARLENS_PG_POOL_MAX: String(this.options.topology.pools.workspacePoolMax),
      VARLENS_PG_APPLICATION_NAME: `varlens-web-user-${secretRef}`
    })
    if (config === null) {
      throw new Error(`hosted private DB secret file did not contain a PostgreSQL URL: ${secretRef}`)
    }
    return await openPostgresStorageSessionWithoutMigrating(config)
  }

  private scheduleIdleClose(
    secretRef: string,
    session: Promise<PostgresStorageSession>
  ): NodeJS.Timeout {
    return setTimeout(() => {
      const current = this.sessionsBySecretRef.get(secretRef)
      if (current?.session !== session) return
      this.sessionsBySecretRef.delete(secretRef)
      session
        .then(async (resolved) => resolved.close())
        .catch(() => {
          // Session creation failures are already surfaced to the request path.
        })
    }, this.options.topology.pools.workspacePoolIdleMs)
  }
}
