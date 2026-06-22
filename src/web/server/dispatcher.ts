/**
 * Single-route HTTP dispatcher for `window.api.<domain>.<method>(...)`.
 *
 * The browser's `window.api` is a Proxy (src/web/client/api.ts) that
 * forwards every call as `POST /api/<domain>/<method>` with body
 * `{ args: [...] }`. This file is the server side: one route resolves
 * the call against three layers, in order:
 *
 *   1. Per-domain OVERRIDES — for methods that don't fit the
 *      executor task model (auth login/logout/whoami, cases:list,
 *      database:capabilities). Override handlers receive `(args, deps)`.
 *   2. Read-task autoroute — if `<domain>:<method>` is one of the
 *      StorageReadTask types, dispatch to `getReadExecutor()`.
 *   3. Write-task autoroute — same for StorageWriteTask.
 *
 * Anything else returns 404. The type sets in task-types.ts are
 * `as const satisfies` against the executor unions, so the
 * autoroute mapping cannot drift silently.
 *
 * Sessions / auth are wired separately as a Fastify preHandler in
 * server/auth.ts; this dispatcher assumes the caller is already
 * authenticated for everything except the few public overrides
 * marked `public: true`.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { StorageReadTask } from '../../main/storage/read-executor'
import type { StorageWriteTask } from '../../main/storage/write-executor'
import { ErrorCode, isIpcError, type SerializableError } from '../../shared/types/errors'
import { toSerializableError } from '../../main/ipc/serializable-error'
import { isReadTaskType, isWriteTaskType, toTaskDomain } from './task-types'
import { buildAnalysisGroupOverrides } from './routes/analysis-groups'
import { buildAnnotationOverrides } from './routes/annotations'
import { buildAuditLogOverrides } from './routes/audit-log'
import { buildAuthOverrides } from './routes/auth'
import { buildBatchImportOverrides } from './routes/batch-import'
import { buildCaseMetadataOverrides } from './routes/case-metadata'
import { buildCasesOverrides } from './routes/cases'
import { buildCohortOverrides } from './routes/cohort'
import { buildDatabaseOverrides } from './routes/database'
import { buildExportOverrides } from './routes/export'
import { buildGeneListOverrides } from './routes/gene-lists'
import { buildGeneRefOverrides } from './routes/gene-ref'
import { buildHpoOverrides } from './routes/hpo'
import { buildImportOverrides } from './routes/import'
import { buildPanelOverrides } from './routes/panels'
import { buildProteinOverrides } from './routes/protein'
import { buildRegionFileOverrides } from './routes/region-files'
import { buildTranscriptOverrides } from './routes/transcripts'
import { buildVepOverrides } from './routes/vep'
import { buildVariantOverrides } from './routes/variants'
import type { DispatcherDeps, InvokeBody, OverrideHandler } from './routes/types'
import {
  recordApiReadAudit,
  recordApiWriteAudit,
  shouldAuditApiRead,
  shouldAuditOverrideWrite
} from './audit'
import {
  DispatcherErrorResponseSchema,
  DispatcherInvokeBodySchema,
  DispatcherParamsSchema
} from '../../shared/api/schemas/dispatcher'

/**
 * Methods reachable to a session that still has
 * must_change_password=TRUE. Everything else returns 403 until the
 * user rotates. This is the load-bearing gate that closes the
 * bootstrap-credential exposure window: even with a valid session
 * cookie, the bootstrap user has zero application-surface access
 * until the new password is committed.
 *
 * `auth:logout` is included so a user who's stuck in the rotation
 * flow can drop their session and start over.
 */
const PRE_ROTATION_ALLOWED = new Set<string>(['auth:changePassword', 'auth:logout'])
const DEV_API_LATENCY_ENV = 'VARLENS_WEB_API_LATENCY_MS'
const CONTROL_DB_METHODS = new Set<string>([
  'auth:login',
  'auth:logout',
  'auth:currentUser',
  'auth:isAccountsEnabled',
  'auth:changePassword',
  'auth:listUsers',
  'auth:deactivateUser',
  'auth:resetPassword',
  'database:capabilities'
])

function toSerializableWebError(error: unknown): SerializableError {
  if (isIpcError(error)) return error
  if (error instanceof Error) return toSerializableError(error)

  const details =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  const message =
    details !== undefined && typeof details.message === 'string'
      ? details.message
      : details !== undefined && typeof details.error === 'string'
        ? details.error
        : String(error)

  return {
    code: ErrorCode.UNKNOWN,
    message,
    userMessage: message,
    ...(details !== undefined ? { details } : {})
  }
}

async function invokeAsIpcResult(
  reply: { statusCode: number; code: (statusCode: number) => unknown },
  invoke: () => Promise<unknown>
): Promise<unknown> {
  try {
    const result = await invoke()
    if (reply.statusCode >= 400) {
      return toSerializableWebError(result)
    }
    return result
  } catch (error) {
    reply.code(500)
    return toSerializableWebError(error)
  }
}

export function resolveDevApiLatencyMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env.NODE_ENV !== 'development') return 0

  const raw = env[DEV_API_LATENCY_ENV]
  if (raw === undefined || raw.trim() === '') return 0

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 5000) {
    throw new Error(`${DEV_API_LATENCY_ENV} must be an integer between 0 and 5000; got ${raw}`)
  }
  return value
}

async function applyDevApiLatency(): Promise<void> {
  const delayMs = resolveDevApiLatencyMs()
  if (delayMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

export type { DispatcherDeps, InvokeBody, OverrideHandler } from './routes/types'

/**
 * Per-method overrides. Key shape: `<kebab-domain>:<method>`.
 *
 * Login binds the session cookie on success; logout clears it; the
 * preHandler reads `request.session.userId` to gate everything else.
 */
function buildOverrides(): Record<string, OverrideHandler> {
  return {
    ...buildAuthOverrides(),
    ...buildAnalysisGroupOverrides(),
    ...buildAnnotationOverrides(),
    ...buildAuditLogOverrides(),
    ...buildBatchImportOverrides(),
    ...buildCaseMetadataOverrides(),
    ...buildCasesOverrides(),
    ...buildCohortOverrides(),
    ...buildDatabaseOverrides(),
    ...buildExportOverrides(),
    ...buildGeneListOverrides(),
    ...buildGeneRefOverrides(),
    ...buildHpoOverrides(),
    ...buildImportOverrides(),
    ...buildPanelOverrides(),
    ...buildProteinOverrides(),
    ...buildRegionFileOverrides(),
    ...buildTranscriptOverrides(),
    ...buildVepOverrides(),
    ...buildVariantOverrides()
  }
}

const PUBLIC_OVERRIDE_KEYS = (overrides: Record<string, OverrideHandler>): Set<string> =>
  new Set(
    Object.entries(overrides)
      .filter(([, v]) => v.public === true)
      .map(([k]) => k)
  )

export function publicOverrideKeys(overrides: Record<string, OverrideHandler>): Set<string> {
  return PUBLIC_OVERRIDE_KEYS(overrides)
}

export function buildDispatcher(_deps: DispatcherDeps): {
  overrides: Record<string, OverrideHandler>
  publicMethods: Set<string>
} {
  const overrides = buildOverrides()
  return { overrides, publicMethods: publicOverrideKeys(overrides) }
}

async function resolveDepsForMethod(
  deps: DispatcherDeps,
  key: string,
  request: Parameters<OverrideHandler['handle']>[1]
): Promise<DispatcherDeps> {
  if (deps.resolveSession === undefined || CONTROL_DB_METHODS.has(key)) {
    return deps
  }
  return {
    ...deps,
    session: await deps.resolveSession(request)
  }
}

/**
 * Register the single dispatcher route. All `POST /api/<domain>/<method>`
 * traffic from the browser lands here.
 */
export function registerDispatcher(
  app: FastifyInstance,
  deps: DispatcherDeps,
  overrides: Record<string, OverrideHandler>
): void {
  app.withTypeProvider<ZodTypeProvider>().post<{
    Params: { domain: string; method: string }
    Body: InvokeBody
  }>(
    '/api/:domain/:method',
    {
      schema: {
        hide: true,
        tags: ['web-dispatcher'],
        summary: 'Invoke a VarLens API method through the generic RPC fallback',
        description:
          'Generic RPC fallback used by the web SPA when a method does not have more specific ' +
          'OpenAPI documentation. This is compatibility coverage for the desktop preload API ' +
          'shape, not a claim that every method has a typed endpoint schema.',
        params: DispatcherParamsSchema,
        body: DispatcherInvokeBodySchema,
        response: {
          400: DispatcherErrorResponseSchema,
          401: DispatcherErrorResponseSchema,
          403: DispatcherErrorResponseSchema,
          404: DispatcherErrorResponseSchema,
          500: DispatcherErrorResponseSchema,
          501: DispatcherErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      await applyDevApiLatency()

      const { domain, method } = request.params
      const args = (request.body?.args ?? []) as unknown[]

      const taskDomain = toTaskDomain(domain)
      const key = `${taskDomain}:${method}`
      const override = overrides[key]

      // Pre-rotation gate. A session that still carries
      // must_change_password gets exactly two methods reachable —
      // changePassword (the way out) and logout (the escape hatch).
      // Everything else, including reads, is 403'd. This closes the
      // bootstrap-credential exposure window completely: there is no
      // moment in which a user with the bootstrap password can call
      // any application endpoint.
      if (
        request.session?.user !== undefined &&
        request.session.mustChangePassword === true &&
        !PRE_ROTATION_ALLOWED.has(key)
      ) {
        reply.code(403)
        return {
          code: ErrorCode.UNKNOWN,
          message: 'password-rotation-required',
          userMessage:
            'Your password must be changed before any other action. ' +
            'Call auth:changePassword first.'
        } satisfies SerializableError
      }

      if (override !== undefined) {
        const requestDeps = await resolveDepsForMethod(deps, key, request)
        const result = await invokeAsIpcResult(reply, () =>
          override.handle(args, request, reply, requestDeps)
        )
        if (reply.statusCode < 400 && (isWriteTaskType(key) || shouldAuditOverrideWrite(key))) {
          const auditResult = await invokeAsIpcResult(reply, () =>
            recordApiWriteAudit(requestDeps, { key, username: request.session?.user?.username })
          )
          if (reply.statusCode >= 400) return auditResult
        } else if (reply.statusCode < 400 && shouldAuditApiRead(key)) {
          const auditResult = await invokeAsIpcResult(reply, () =>
            recordApiReadAudit(requestDeps, { key, username: request.session?.user?.username })
          )
          if (reply.statusCode >= 400) return auditResult
        }
        return result
      }

      if (isReadTaskType(key)) {
        const requestDeps = await resolveDepsForMethod(deps, key, request)
        const task = { type: key, params: args } as StorageReadTask
        const result = await invokeAsIpcResult(reply, () =>
          requestDeps.session.getReadExecutor().execute(task)
        )
        if (reply.statusCode < 400 && shouldAuditApiRead(key)) {
          const auditResult = await invokeAsIpcResult(reply, () =>
            recordApiReadAudit(requestDeps, { key, username: request.session?.user?.username })
          )
          if (reply.statusCode >= 400) return auditResult
        }
        return result
      }

      if (isWriteTaskType(key)) {
        const requestDeps = await resolveDepsForMethod(deps, key, request)
        const task = { type: key, params: args } as StorageWriteTask
        const result = await invokeAsIpcResult(reply, () =>
          requestDeps.session.getWriteExecutor().execute(task)
        )
        if (reply.statusCode < 400) {
          const auditResult = await invokeAsIpcResult(reply, () =>
            recordApiWriteAudit(requestDeps, { key, username: request.session?.user?.username })
          )
          if (reply.statusCode >= 400) return auditResult
        }
        return result
      }

      reply.code(404)
      return {
        code: ErrorCode.NOT_FOUND,
        message: 'unknown method',
        userMessage: 'Unknown API method.',
        details: { domain, method }
      } satisfies SerializableError
    }
  )
}
