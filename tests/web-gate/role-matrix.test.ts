/**
 * Role × endpoint matrix at the HTTP boundary (PR-W8, Limin L11).
 *
 * Every dispatcher method is called over `POST /api/<domain>/<method>` by a
 * viewer, an analyst and an admin. A role below the method's policy must get
 * 403 `role-required` before any handler, storage executor or auth-service
 * mutation runs; a sufficient role must get past authorization (the call may
 * still fail validation on the empty argument list — that is not a 403).
 *
 * The expected decision is computed from roleAtLeast(), and the policies are
 * pinned by operation-security-registry.test.ts, so this file proves the
 * wrapper enforces the map for every method rather than restating the map.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { DISPATCHER_SECURITY_MAP } from '../../src/web/server/security/operation-security-map'
import { DOMAIN_CAMEL_TO_KEBAB } from '../../src/web/server/task-types'
import { roleAtLeast, USER_ROLES, type UserRole } from '../../src/shared/auth/auth-constants'
import { makeDeps } from './helpers/dispatcher-adapters'

const KEBAB_TO_CAMEL = new Map(
  Object.entries(DOMAIN_CAMEL_TO_KEBAB).map(([camel, kebab]) => [kebab, camel])
)

function urlFor(key: string): string {
  const [domain, method] = key.split(':')
  return `/api/${KEBAB_TO_CAMEL.get(domain) ?? domain}/${method}`
}

function jsonBody(response: { body: string }): unknown {
  return response.body === '' ? null : (JSON.parse(response.body) as unknown)
}

function isRoleRefusal(statusCode: number, body: unknown): boolean {
  const details = (body as { details?: { error?: string } } | null)?.details
  return statusCode === 403 && details?.error === 'role-required'
}

/**
 * Methods whose handlers start real background work (workers, timers,
 * global job runners) even on empty arguments; for these the matrix checks
 * only the refusal side, where no handler code runs at all.
 */
const REFUSAL_ONLY = new Set<string>([
  'batch-import:start',
  'cohort:runAssociation',
  'cohort:rebuildSummary',
  'import:start',
  'import:startMultiFile'
])

function buildApp(role: UserRole): { app: FastifyInstance; deps: ReturnType<typeof makeDeps> } {
  const made = makeDeps()
  const app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook('preHandler', async (request) => {
    request.session = {
      user: { id: 7, username: `${role}-user`, role, passwordChangedAt: null },
      mustChangePassword: false
    } as never
  })
  registerDispatcher(app, made.deps, buildDispatcher(made.deps).overrides)
  return { app, deps: made }
}

const mutatingAuthMethods = [
  'createUser',
  'setRole',
  'deactivateUser',
  'reactivateUser',
  'resetPassword'
] as const

describe.each(USER_ROLES.map((role) => [role]))('role matrix: %s', (role) => {
  let app: FastifyInstance
  let made: ReturnType<typeof makeDeps>

  beforeAll(() => {
    ;({ app, deps: made } = buildApp(role))
  })
  afterAll(async () => {
    await app.close()
  })

  const entries = Object.entries(DISPATCHER_SECURITY_MAP).filter(([, p]) => p.minRole !== 'public')

  test.each(entries.map(([key, policy]) => [key, policy.minRole, policy.kind]))(
    '%s (min %s, %s)',
    async (key) => {
      const policy = DISPATCHER_SECURITY_MAP[key]
      const allowed = roleAtLeast(role, policy.minRole as UserRole)
      if (allowed && REFUSAL_ONLY.has(key)) return

      vi.clearAllMocks()
      const response = await app.inject({ method: 'POST', url: urlFor(key), payload: { args: [] } })
      const body = jsonBody(response)

      if (allowed) {
        expect(isRoleRefusal(response.statusCode, body), `${role} must reach ${key}`).toBe(false)
        expect(response.statusCode, `${key} must resolve`).not.toBe(404)
        return
      }

      expect(isRoleRefusal(response.statusCode, body), `${role} must be refused ${key}`).toBe(true)
      expect(body).toMatchObject({ details: { requiredRole: policy.minRole } })
      // Refused before any handler work: no storage access, no audit row,
      // no account mutation.
      expect(made.execute).not.toHaveBeenCalled()
      expect(made.writeExecute).not.toHaveBeenCalled()
      for (const method of mutatingAuthMethods) {
        expect(made.deps.authService[method]).not.toHaveBeenCalled()
      }
    }
  )
})

describe('role matrix: anonymous and legacy roles', () => {
  test('a session with an unknown role is refused every non-public method', async () => {
    const made = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 9, username: 'mallory', role: 'superuser', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, made.deps, buildDispatcher(made.deps).overrides)

    for (const key of ['variants:query', 'annotations:upsertGlobal', 'auth:listUsers']) {
      const response = await app.inject({ method: 'POST', url: urlFor(key), payload: { args: [] } })
      expect(isRoleRefusal(response.statusCode, jsonBody(response)), key).toBe(true)
    }
    expect(made.execute).not.toHaveBeenCalled()
    await app.close()
  })

  test('a stale cookie carrying the legacy user role acts as an analyst', async () => {
    const made = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 9, username: 'legacy', role: 'user', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, made.deps, buildDispatcher(made.deps).overrides)

    const tag = await app.inject({
      method: 'POST',
      url: urlFor('tags:create'),
      payload: { args: ['x', '#fff'] }
    })
    expect(tag.statusCode).toBe(200)
    const users = await app.inject({ method: 'POST', url: urlFor('auth:listUsers') })
    expect(isRoleRefusal(users.statusCode, jsonBody(users))).toBe(true)
    await app.close()
  })

  test('the audit row of an allowed write is attributed to the session actor', async () => {
    const { app, deps: made } = buildApp('analyst')
    const response = await app.inject({
      method: 'POST',
      url: urlFor('tags:create'),
      payload: { args: ['x', '#fff'] }
    })
    expect(response.statusCode).toBe(200)
    expect(made.writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        expect.objectContaining({
          action_type: 'api_write',
          entity_key: 'tags:create',
          user_name: 'analyst-user'
        })
      ]
    })
    await app.close()
  })
})
