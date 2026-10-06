/**
 * Audit-log read gating (spec AS-5): audit:query is admin-only and
 * audit:getByEntity is entity-scoped for everyone else; neither is an
 * autorouted read task. The trail contains
 * employee activity (logins, API access), so clinical users must not be
 * able to browse it — and an admin reading it is itself an audited access.
 */
import { describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { isReadTaskType } from '../../src/web/server/task-types'
import { makeDeps } from './helpers/dispatcher-adapters'

function buildApp(
  deps: ReturnType<typeof makeDeps>['deps'],
  role: 'admin' | 'analyst' | 'viewer'
): FastifyInstance {
  const app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook('preHandler', async (request) => {
    request.session = {
      user: {
        id: 1,
        username: role,
        role,
        passwordChangedAt: null
      }
    } as never
  })
  registerDispatcher(app, deps, buildDispatcher(deps).overrides)
  return app
}

describe('web dispatcher: audit-log read gating', () => {
  test('audit reads are not autorouted read tasks', () => {
    expect(isReadTaskType('audit:query')).toBe(false)
    expect(isReadTaskType('audit:getByEntity')).toBe(false)
  })

  test('non-admin audit:query returns 403 without touching storage or the trail', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    const app = buildApp(deps, 'analyst')

    const query = await app.inject({
      method: 'POST',
      url: '/api/audit/query',
      payload: { args: [{ limit: 10 }] }
    })

    expect(query.statusCode).toBe(403)
    expect(query.json()).toMatchObject({
      details: { error: 'role-required', requiredRole: 'admin' }
    })
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
    await app.close()
  })

  test('viewer audit:getByEntity gets the clinical history only (P-16)', async () => {
    const { deps, execute } = makeDeps()
    execute.mockResolvedValueOnce([
      { id: 1, entity_type: 'variant_annotation', entity_key: '1:100:A:G' },
      { id: 2, entity_type: 'case_variant_annotation', entity_key: '1:100:A:G' },
      { id: 3, entity_type: 'user_account', entity_key: '1:100:A:G' },
      { id: 4, entity_type: 'api_call', entity_key: '1:100:A:G' }
    ] as never)
    const app = buildApp(deps, 'viewer')

    const byEntity = await app.inject({
      method: 'POST',
      url: '/api/audit/getByEntity',
      payload: { args: ['1:100:A:G'] }
    })

    expect(byEntity.statusCode).toBe(200)
    expect((byEntity.json() as Array<{ id: number }>).map((row) => row.id)).toEqual([1, 2])
    await app.close()
  })

  test('admin audit:query succeeds and the access is itself read-audited', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    const app = buildApp(deps, 'admin')

    const query = await app.inject({
      method: 'POST',
      url: '/api/audit/query',
      payload: { args: [{ limit: 10 }] }
    })

    expect(query.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledWith({ type: 'audit:query', params: [{ limit: 10 }] })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_read',
          entity_type: 'api_call',
          entity_key: 'audit:query',
          old_value: null,
          new_value: { success: true, method: 'audit:query' },
          user_name: 'admin',
          metadata: { source: 'web-dispatcher' }
        }
      ]
    })
    await app.close()
  })

  test('admin audit:getByEntity delegates to the read executor', async () => {
    const { deps, execute } = makeDeps()
    const app = buildApp(deps, 'admin')

    const byEntity = await app.inject({
      method: 'POST',
      url: '/api/audit/getByEntity',
      payload: { args: ['1:100:A:G'] }
    })

    expect(byEntity.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledWith({ type: 'audit:getByEntity', params: ['1:100:A:G'] })
    await app.close()
  })
})
