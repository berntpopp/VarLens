import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { FastifyRequest } from 'fastify'

import { getPostgresStorageConfig } from '../main/storage/config'
import { openPostgresStorageSessionWithoutMigrating } from '../main/storage/postgres/createPostgresStorageSession'
import type { PostgresPublicAnnotationRepository } from '../main/storage/postgres/PostgresPublicAnnotationRepository'
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
      publicAnnotations?: PostgresPublicAnnotationRepository
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
    // A3: VARLENS_WORKSPACE_POOL_GLOBAL_MAX is a TOTAL-CLIENT budget (per the hosted
    // DB contract's max_connections arithmetic), not a pool count. Each workspace pool
    // holds up to workspacePoolMax clients, so cap the pool count at
    // floor(globalMax / poolMax) to keep the worst-case client count within budget.
    const { workspacePoolGlobalMax, workspacePoolMax } = this.options.topology.pools
    if ((this.sessionsBySecretRef.size + 1) * workspacePoolMax > workspacePoolGlobalMax) {
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
    const url = (
      await readFile(join(this.options.topology.workspaceSecretDir, secretRef), 'utf8')
    ).trim()
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
      throw new Error(
        `hosted private DB secret file did not contain a PostgreSQL URL: ${secretRef}`
      )
    }
    return await openPostgresStorageSessionWithoutMigrating(config, {
      // A1: fail closed at routing time when the workspace schema version does not
      // match the app's compiled migration head, instead of serving broken requests.
      validateMigrationCompat: true,
      ...(this.options.publicAnnotations !== undefined
        ? { publicAnnotations: this.options.publicAnnotations }
        : {})
    })
  }

  private scheduleIdleClose(
    secretRef: string,
    session: Promise<PostgresStorageSession>
  ): NodeJS.Timeout {
    return setTimeout(() => {
      void this.closeIfIdle(secretRef, session)
    }, this.options.topology.pools.workspacePoolIdleMs)
  }

  private async closeIfIdle(
    secretRef: string,
    session: Promise<PostgresStorageSession>
  ): Promise<void> {
    const current = this.sessionsBySecretRef.get(secretRef)
    if (current?.session !== session) return

    let resolved: PostgresStorageSession
    try {
      resolved = await session
    } catch {
      // Session creation failures are already surfaced to the request path.
      return
    }
    // Re-check: a request may have re-armed (and swapped the timer) while awaiting.
    const stillCurrent = this.sessionsBySecretRef.get(secretRef)
    if (stillCurrent?.session !== session) return

    // A4: idle TTL is measured against activity, not routing time. Do not tear down a
    // pool that still has borrowed (in-flight) clients — a single request slower than
    // workspacePoolIdleMs would otherwise race pool teardown. Re-arm and check again.
    if (this.poolHasBorrowedClients(resolved)) {
      stillCurrent.idleTimer = this.scheduleIdleClose(secretRef, session)
      return
    }

    this.sessionsBySecretRef.delete(secretRef)
    await resolved.close()
  }

  private poolHasBorrowedClients(session: PostgresStorageSession): boolean {
    try {
      const pool = session.getPool()
      const total = pool.totalCount ?? 0
      const idle = pool.idleCount ?? 0
      return total - idle > 0
    } catch {
      // If pool stats are unavailable, prefer keeping the session over a mid-flight close.
      return false
    }
  }
}
