/**
 * VarLens web server entrypoint — Postgres-only.
 *
 * Single-DB web mode requires VARLENS_PG_URL and refuses to boot without it.
 * Hosted web mode uses the explicit control/workspace/public DB topology env.
 * Desktop SQLite stays untouched in src/main/.
 *
 *   - Fastify app with Pino JSON logging
 *   - `/livez` (process-only), `/readyz` (DB readiness), `/healthz` (readiness alias)
 *   - SIGTERM/SIGINT graceful shutdown
 *   - Postgres-backed StorageSession (cases, variants) and
 *     PostgresWebAuthService (auth)
 *   - Session-secret material lives under VARLENS_RECOVERY_KEY_DIR
 *     (default `/data`)
 *   - Fail-loud boot: missing required DB topology env aborts before any port
 *     is bound; missing VARLENS_RECOVERY_KEY_DIR (when admin bootstrap is
 *     requested) likewise.
 *
 * Two consumers:
 *   - tests import `buildApp` directly (no listen/signals)
 *   - production runs `node out/web/server.cjs` via main()
 */

import { isAbsolute } from 'path'

import Fastify, { type FastifyInstance } from 'fastify'
import { Pool } from 'pg'

import { buildPostgresPoolConfig, getPostgresStorageConfig } from '../main/storage/config'
import { createPostgresStorageSession } from '../main/storage/postgres/createPostgresStorageSession'
import { PostgresPublicAnnotationRepository } from '../main/storage/postgres/PostgresPublicAnnotationRepository'
import type { PostgresStorageSession } from '../main/storage/postgres/PostgresStorageSession'
import type { StorageSession } from '../main/storage/session'
import { AdminAlreadyExistsError, PostgresWebAuthService } from './auth/PostgresWebAuthService'
import { HostedUserDbRouter } from './hosted-user-db-router'
import { recordAuthAudit } from './server/audit'
import { buildDispatcher, registerDispatcher } from './server/dispatcher'
import { registerSessions } from './server/auth'
import { registerEventStream, WebEventHub } from './server/events'
import { registerLoginRoute, resolveAppPathPrefix } from './server/login-route'
import { registerPageGate } from './server/page-gate'
import { PlatformIdentityService, registerPlatformIdentityRoutes } from './server/platform-identity'
import { readPlatformIdentityConfig } from './server/platform-identity-config'
import { registerWebRateLimit } from './server/rate-limit'
import { registerImportUploadRoutes } from './server/routes/upload-staging'
import { registerOpenApi } from './server/routes/openapi'
import { registerStatic } from './server/static'
import { readWebDbTopology } from './topology'
import {
  type AppMetrics,
  createAppMetricsFromEnv,
  registerRequestMetrics,
  startMetricsServer
} from './server/metrics'
import pkg from '../../package.json'

/**
 * Admin bootstrap on first boot. A pre-computed Argon2id hash is
 * required; plaintext bootstrap passwords are refused before boot.
 *
 * Tests construct this directly; production reads from env via
 * `readAdminEnv()` below.
 */
export interface AdminBootstrapOptions {
  username: string
  /** Pre-computed Argon2id hash. */
  passwordHash: string
  /** Plaintext password. Refused if passed by legacy callers. */
  password?: string
  displayName?: string
  /**
   * Whether the bootstrapped admin must rotate its password on first login.
   * Defaults to `true` (secure default). Set `false` only for local dev via
   * `VARLENS_ADMIN_MUST_CHANGE_PASSWORD=false` so a stable default dev
   * credential survives without a forced rotation.
   */
  mustChangePassword?: boolean
}

/**
 * Empty-object options is intentional: every parameter the web server
 * needs comes from the env (DB topology, VARLENS_RECOVERY_KEY_DIR,
 * VARLENS_ADMIN_*).
 * Tests can still pass `admin` to override the env-driven path.
 */
export interface BuildAppOptions {
  admin?: AdminBootstrapOptions
  metrics?: AppMetrics
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const topology = readWebDbTopology(process.env)
  const appPathPrefix = resolveAppPathPrefix()
  const platformIdentityConfig = readPlatformIdentityConfig(process.env)
  const platformIdentity =
    platformIdentityConfig === null
      ? undefined
      : new PlatformIdentityService(platformIdentityConfig)

  // Validate Postgres config BEFORE building the app; any later
  // failure path means we'd hold a partially-spun Fastify instance,
  // which the SIGTERM tests can't cleanly tear down.
  const pgConfig =
    topology.mode === 'hosted'
      ? getPostgresStorageConfig({
          ...process.env,
          VARLENS_PG_URL: topology.controlStateUrl,
          VARLENS_PG_POOL_MAX: String(topology.pools.controlPoolMax),
          VARLENS_PG_APPLICATION_NAME: 'varlens-web-control'
        })
      : getPostgresStorageConfig(process.env)
  if (pgConfig === null) {
    throw new Error(
      topology.mode === 'hosted'
        ? 'VARLENS_CONTROL_STATE_PG_URL must be set when VARLENS_WEB_DB_TOPOLOGY=hosted.'
        : 'VARLENS_PG_URL must be set. The web server is Postgres-only; ' +
            'set it to the Postgres connection URL before starting the server.'
    )
  }

  const app = Fastify({
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
    logger: {
      level: process.env.VARLENS_LOG_LEVEL ?? 'info'
    }
  })
  const metrics = options.metrics ?? createAppMetricsFromEnv()
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })
  registerRequestMetrics(app, metrics)
  await registerWebRateLimit(app)

  const session: PostgresStorageSession = await createPostgresStorageSession(pgConfig)
  // Share the storage session's pool with the auth service so we open
  // exactly one state-capable control connection pool per process. The public getPool()
  // accessor (added in the QA round on Step 4) makes this contract
  // type-checked rather than a structural cast.
  const pool = session.getPool()
  const controlReadPool =
    topology.mode === 'hosted'
      ? new Pool(
          buildPostgresPoolConfig({
            ...pgConfig,
            url: topology.controlReadUrl,
            applicationName: 'varlens-web-control-read',
            poolMax: topology.pools.controlPoolMax
          })
        )
      : null
  const authService = new PostgresWebAuthService({
    pool,
    ...(controlReadPool !== null ? { readPool: controlReadPool } : {}),
    schema: pgConfig.schema
  })
  const publicAnnotationPool =
    topology.mode === 'hosted' && topology.publicAnnotationUrl !== undefined
      ? new Pool(
          buildPostgresPoolConfig({
            ...pgConfig,
            url: topology.publicAnnotationUrl,
            applicationName: 'varlens-web-public-annotations',
            poolMax: topology.pools.publicAnnotationPoolMax
          })
        )
      : null
  const publicAnnotations =
    publicAnnotationPool === null
      ? undefined
      : new PostgresPublicAnnotationRepository(publicAnnotationPool)
  const hostedRouter =
    topology.mode === 'hosted'
      ? new HostedUserDbRouter({
          topology,
          authService,
          ...(publicAnnotations !== undefined ? { publicAnnotations } : {})
        })
      : null

  if (options.admin !== undefined) {
    await maybeBootstrapAdmin(authService, options.admin, app.log)
  }

  await registerSessions(app, {
    authService,
    ...(platformIdentity !== undefined ? { platformIdentity } : {})
  })
  await registerOpenApi(app)
  const events = new WebEventHub()

  // Login wall: the `/login` page itself + the preHandler that redirects
  // unauthenticated GETs to it. Registered before the dispatcher and
  // static handler so the explicit `/login` route wins over the SPA
  // fallback, and so the gate runs before any route handler ships
  // bytes. `/api/*`, `/livez`, `/readyz`, `/healthz`, and `/login*`
  // are passthrough.
  if (platformIdentity !== undefined) {
    registerPlatformIdentityRoutes(app, {
      identity: platformIdentity,
      authService,
      appPathPrefix,
      audit: async (event) => {
        await recordAuthAudit(
          { session: session as StorageSession } as Parameters<typeof recordAuthAudit>[0],
          {
            action_type: event.action,
            username: event.subject ?? 'platform-login-attempt',
            ...(event.subject !== undefined ? { actor: event.subject } : {}),
            ...(event.role !== undefined ? { role: event.role } : {}),
            success: event.action === 'auth_login_success',
            ...(event.reason !== undefined ? { reason: event.reason } : {})
          }
        )
      }
    })
  }
  registerLoginRoute(app, { platformAuthEnabled: platformIdentity !== undefined })
  registerPageGate(app, {
    appPathPrefix,
    loginPath: platformIdentity !== undefined ? '/auth/platform/start' : '/login',
    ...(platformIdentity !== undefined
      ? {
          platformCallbackPath: platformIdentity.config.callbackPath,
          requirePlatformAuth: true
        }
      : {})
  })

  const dispatcherDeps = {
    session: session as StorageSession,
    authService,
    events,
    metrics,
    ...(hostedRouter !== null
      ? {
          resolveSession: (request: Parameters<HostedUserDbRouter['resolveSession']>[0]) =>
            hostedRouter.resolveSession(request)
        }
      : {})
  }
  const { overrides } = buildDispatcher(dispatcherDeps)
  registerImportUploadRoutes(app, dispatcherDeps)
  registerDispatcher(app, dispatcherDeps, overrides)
  registerEventStream(app, events)

  app.get('/livez', { schema: { hide: true } }, async () => {
    return { status: 'ok', version: pkg.version }
  })

  const readinessHandler = async (_request: unknown, reply: import('fastify').FastifyReply) => {
    const open = await isPostgresHealthy(pool)
    const controlReadOpen =
      controlReadPool === null ? true : await isPostgresHealthy(controlReadPool)
    const publicAnnotationOpen =
      publicAnnotationPool === null ? true : await isPostgresHealthy(publicAnnotationPool)
    const allOpen = open && controlReadOpen && publicAnnotationOpen
    metrics.setDatabaseHealthy(allOpen)
    if (!allOpen) {
      reply.code(503)
      return {
        status: 'unhealthy',
        version: pkg.version,
        db: { open: allOpen },
        publicAnnotationDb: { open: publicAnnotationOpen }
      }
    }
    return {
      status: 'ok',
      version: pkg.version,
      db: { open: true },
      publicAnnotationDb: { open: publicAnnotationOpen }
    }
  }

  app.get('/readyz', { schema: { hide: true } }, readinessHandler)
  app.get('/healthz', { schema: { hide: true } }, readinessHandler)

  await registerStatic(app)

  app.addHook('onClose', async () => {
    try {
      await hostedRouter?.close()
      await controlReadPool?.end()
      await publicAnnotationPool?.end()
      await session.close()
    } catch {
      // ignore close errors during shutdown
    }
  })

  return app
}

interface BootstrapLogger {
  info: (obj: object, msg?: string) => void
  warn: (obj: object, msg?: string) => void
  fatal: (obj: object, msg?: string) => void
}

/**
 * Validates `VARLENS_RECOVERY_KEY_DIR`. Kept around because the
 * session-secret file (`web-session-secret`) lives in this directory
 * and `auth.ts` resolves the same env var. The recovery-key *file*
 * (`admin-recovery-key.txt`) was deleted in the 2026-security pass —
 * it was plaintext on disk that no consumer code read.
 */
function validateRecoveryKeyDir(): void {
  const raw = process.env.VARLENS_RECOVERY_KEY_DIR
  if (raw === undefined || raw.trim() === '') return
  if (!isAbsolute(raw.trim())) {
    throw new Error(
      `VARLENS_RECOVERY_KEY_DIR must be an absolute path; got: ${JSON.stringify(raw)}`
    )
  }
}

async function maybeBootstrapAdmin(
  authService: PostgresWebAuthService,
  admin: AdminBootstrapOptions,
  log: BootstrapLogger
): Promise<void> {
  validateRecoveryKeyDir()

  if (typeof admin.password === 'string' && admin.password !== '') {
    throw new Error(
      'VARLENS_ADMIN_PASSWORD plaintext bootstrap is not supported. ' +
        'Generate a hash with `npm run varlens:hash-password` and set VARLENS_ADMIN_PASSWORD_HASH.'
    )
  }

  // Steady-state pre-check: if an admin already exists, the env vars
  // are stale (operator forgot to blank them after first boot) — log
  // loudly that we're ignoring them and return. The partial unique
  // index in migration 0007 still guarantees race-safety on truly
  // concurrent first-user calls; this is a fast-path.
  if (await authService.hasAdmin()) {
    log.warn(
      {
        event: 'admin-bootstrap',
        action: 'env-rotation-ignored',
        username: admin.username
      },
      'VARLENS_ADMIN_* set but an admin already exists — env-based rotation is NOT supported; ignoring.'
    )
    log.info({ event: 'admin-bootstrap', action: 'skipped', reason: 'admin-exists' })
    return
  }

  // Hash-only bootstrap. The web server never needs to see the
  // bootstrap password at any process boundary.
  const useHash = typeof admin.passwordHash === 'string' && admin.passwordHash !== ''
  if (!useHash) {
    throw new Error(
      'admin bootstrap: VARLENS_ADMIN_PASSWORD_HASH is required. ' +
        'Generate a hash with `npm run varlens:hash-password` and set VARLENS_ADMIN_PASSWORD_HASH.'
    )
  }

  const mustChangePassword = admin.mustChangePassword ?? true

  try {
    await authService.createFirstUserFromHash(
      admin.username,
      admin.displayName ?? admin.username,
      admin.passwordHash,
      mustChangePassword
    )
  } catch (createErr) {
    // Race-loser branch: a concurrent first-user call beat us to the
    // partial unique index. The hasAdmin() pre-check above covers the
    // steady-state case; this branch covers exactly the race window.
    if (createErr instanceof AdminAlreadyExistsError) {
      log.warn(
        {
          event: 'admin-bootstrap',
          action: 'env-rotation-ignored-race',
          username: admin.username
        },
        'admin bootstrap raced an existing admin INSERT — env-based rotation is NOT supported; ignoring.'
      )
      log.info({ event: 'admin-bootstrap', action: 'skipped', reason: 'admin-exists' })
      return
    }
    throw createErr
  }

  // The bootstrapped admin is created with must_change_password=TRUE.
  // The dispatcher's pre-rotation gate enforces that this user can
  // only call auth:changePassword and auth:logout — so even though a
  // login succeeds with the bootstrap credentials, the resulting
  // session has zero application-surface access until the user picks
  // a new password. There is no exposure window where the bootstrap
  // password could read or write any data.
  log.info(
    {
      event: 'admin-bootstrap',
      action: 'created',
      username: admin.username,
      mustChangePassword,
      via: 'hash'
    },
    mustChangePassword
      ? 'admin created — must rotate on first login (via hash)'
      : 'admin created WITHOUT forced rotation (VARLENS_ADMIN_MUST_CHANGE_PASSWORD=false; dev only) (via hash)'
  )
}

/**
 * Liveness probe that bounds itself: kubernetes / load-balancer probes
 * expect /healthz to return quickly. A wedged Postgres or exhausted
 * pool would otherwise block on `pool.query` indefinitely (pg's
 * default has no statement timeout) and the orchestrator would not
 * see a 503 in time to evict the pod. Cap at 1.5s — well under the
 * typical 5s probe deadline.
 */
async function isPostgresHealthy(pool: import('pg').Pool): Promise<boolean> {
  const HEALTH_PROBE_TIMEOUT_MS = 1500
  let timer: NodeJS.Timeout | undefined
  const probe = pool.query('SELECT 1').then(
    () => true,
    () => false
  )
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), HEALTH_PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([probe, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Resolve admin-bootstrap credentials from env. Plaintext bootstrap
 * (`VARLENS_ADMIN_PASSWORD`) is refused even if
 * a hash is also present, because process env is inspectable in the
 * container runtime.
 *
 * Returns undefined when no usable credential is set, in which case
 * the boot path skips the bootstrap entirely (admin must already
 * exist or the user surface stays unreachable).
 */
function readAdminEnv(): AdminBootstrapOptions | undefined {
  const username = process.env.VARLENS_ADMIN_USERNAME
  const passwordHash = process.env.VARLENS_ADMIN_PASSWORD_HASH
  const password = process.env.VARLENS_ADMIN_PASSWORD
  const displayName = process.env.VARLENS_ADMIN_DISPLAY_NAME
  const passwordSet = typeof password === 'string' && password !== ''

  if (passwordSet) {
    throw new Error(
      'VARLENS_ADMIN_PASSWORD plaintext bootstrap is not supported. ' +
        'Generate a hash with `npm run varlens:hash-password` and set VARLENS_ADMIN_PASSWORD_HASH.'
    )
  }

  if (typeof username !== 'string' || username.trim() === '') {
    return undefined
  }

  const hashSet = typeof passwordHash === 'string' && passwordHash.trim() !== ''
  if (!hashSet) {
    return undefined
  }

  // Secure default: forced rotation on first login. Only an explicit
  // `false`/`0` (dev) opts out so a stable default dev credential survives.
  const mustChangeRaw = process.env.VARLENS_ADMIN_MUST_CHANGE_PASSWORD
  const mustChangePassword = !(mustChangeRaw === 'false' || mustChangeRaw === '0')

  return {
    username: username.trim(),
    passwordHash: (passwordHash as string).trim(),
    displayName:
      typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : undefined,
    mustChangePassword
  }
}

async function main(): Promise<void> {
  const portRaw = process.env.VARLENS_WEB_PORT ?? '0'
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `VARLENS_WEB_PORT must be an integer in [0, 65535]; got: ${JSON.stringify(portRaw)}`
    )
  }
  const host = process.env.VARLENS_WEB_HOST ?? '0.0.0.0'
  const metricsPortRaw = process.env.VARLENS_METRICS_PORT ?? '9090'
  const metricsPort = Number(metricsPortRaw)
  if (!Number.isInteger(metricsPort) || metricsPort < 0 || metricsPort > 65535) {
    throw new Error(
      `VARLENS_METRICS_PORT must be an integer in [0, 65535]; got: ${JSON.stringify(metricsPortRaw)}`
    )
  }
  const metricsHost = process.env.VARLENS_METRICS_HOST ?? '0.0.0.0'
  const metricsPath = process.env.VARLENS_METRICS_PATH ?? '/metrics'
  const metricsEnabled = process.env.VARLENS_METRICS_ENABLED !== '0'
  const metrics = createAppMetricsFromEnv()

  const app = await buildApp({ admin: readAdminEnv(), metrics })

  await app.listen({ port, host })
  const metricsServer = metricsEnabled
    ? await startMetricsServer({ metrics, host: metricsHost, port: metricsPort, path: metricsPath })
    : undefined

  const address = app.server.address()
  const boundPort = address !== null && typeof address === 'object' ? address.port : port
  app.log.info({ port: boundPort }, 'listening')
  if (metricsServer !== undefined) {
    const metricsAddress = metricsServer.address()
    const boundMetricsPort =
      metricsAddress !== null && typeof metricsAddress === 'object'
        ? metricsAddress.port
        : metricsPort
    app.log.info({ port: boundMetricsPort, path: metricsPath }, 'metrics listening')
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    try {
      if (metricsServer !== undefined) {
        await new Promise<void>((resolve, reject) => {
          metricsServer.close((error) => {
            if (error !== undefined) reject(error)
            else resolve()
          })
        })
      }
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
}

declare const require: NodeJS.Require
declare const module: NodeJS.Module
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((err) => {
    const payload = {
      level: 50,
      time: Date.now(),
      msg: 'fatal: web server failed to start',
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
    }
    process.stderr.write(JSON.stringify(payload) + '\n')
    process.exit(1)
  })
}
