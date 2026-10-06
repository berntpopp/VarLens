/**
 * Read audits go through the batched AuditBuffer when one is configured;
 * write audits stay synchronous so a mutation never reports success
 * without its audit row (05-blocking-analysis.md, W-5).
 */
import { describe, expect, test, vi } from 'vitest'
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { AuditBuffer, type BufferedAuditRow } from '../../src/web/server/audit-buffer'
import { makeDeps } from './helpers/dispatcher-adapters'

function buildApp(deps: ReturnType<typeof makeDeps>['deps']) {
  const app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook('preHandler', async (request) => {
    request.session = {
      user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
    } as never
  })
  registerDispatcher(app, deps, buildDispatcher(deps).overrides)
  return app
}

describe('web dispatcher: buffered read audits', () => {
  test('autorouted reads enqueue into the buffer instead of awaiting an INSERT', async () => {
    const { deps, writeExecute } = makeDeps()
    const sink = vi.fn<(rows: BufferedAuditRow[]) => Promise<void>>(async () => undefined)
    deps.auditBuffer = new AuditBuffer({ sink, flushIntervalMs: 60_000 })
    const app = buildApp(deps)

    const res = await app.inject({
      method: 'POST',
      url: '/api/tags/list',
      payload: { args: [] }
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(writeExecute).not.toHaveBeenCalled()
    expect(deps.auditBuffer.pendingCount).toBe(1)

    await deps.auditBuffer.close()
    expect(sink).toHaveBeenCalledWith([
      expect.objectContaining({
        action_type: 'api_read',
        entity_key: 'tags:list',
        user_name: 'admin',
        occurred_at: expect.any(Number)
      })
    ])
  })

  test('autorouted writes keep the synchronous audit insert', async () => {
    const { deps, writeExecute } = makeDeps()
    const sink = vi.fn(async () => undefined)
    deps.auditBuffer = new AuditBuffer({ sink, flushIntervalMs: 60_000 })
    const app = buildApp(deps)

    const res = await app.inject({
      method: 'POST',
      url: '/api/tags/create',
      payload: { args: ['Reviewed', '#336699'] }
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(writeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audit:append',
        params: [expect.objectContaining({ action_type: 'api_write', entity_key: 'tags:create' })]
      })
    )
    expect(deps.auditBuffer.pendingCount).toBe(0)
    await deps.auditBuffer.close()
  })

  test('audit:query drains the buffer before reading the trail', async () => {
    const { deps, execute } = makeDeps()
    const sink = vi.fn(async () => undefined)
    deps.auditBuffer = new AuditBuffer({ sink, flushIntervalMs: 60_000 })
    const app = buildApp(deps)

    await app.inject({ method: 'POST', url: '/api/tags/list', payload: { args: [] } })
    expect(deps.auditBuffer.pendingCount).toBe(1)

    execute.mockImplementationOnce(async () => {
      expect(sink).toHaveBeenCalledTimes(1)
      return { data: [], total_count: 0 } as never
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/query',
      payload: { args: [{ limit: 10 }] }
    })
    expect(res.statusCode, res.body).toBe(200)
    await deps.auditBuffer.close()
  })
})
