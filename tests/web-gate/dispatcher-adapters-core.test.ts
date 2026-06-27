import { describe, expect, test, vi } from 'vitest'
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { makeDeps } from './helpers/dispatcher-adapters'
import { UniqueConstraintError } from '../../src/main/database/errors'
import { AppMetrics, registerRequestMetrics } from '../../src/web/server/metrics'

describe('web dispatcher adapters: variants, transcripts, and errors', () => {
  test('variants.query adapts renderer/preload args to the storage task shape', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:query'].handle(
      [
        7,
        { consequences: ['HIGH'], chr: 'chr22' },
        20,
        10,
        [{ key: 'pos', order: 'desc' }],
        true,
        true
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [
        { case_id: 7, consequences: ['HIGH'], chr: 'chr22' },
        10,
        20,
        [{ key: 'pos', order: 'desc' }],
        true,
        true
      ]
    })
  })

  test('variants.query applies desktop IPC defaults for omitted optional args', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:query'].handle([7, {}], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [{ case_id: 7 }, 50, 0, undefined, false, false]
    })
  })

  test('variants.getFilterOptions maps the preload method name to variants:filterOptions', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:getFilterOptions'].handle([7], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:filterOptions',
      params: [7]
    })
  })

  test('variants.search uses shared search logic and rejects non-number limits', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce([{ id: 1, consequence: 'stop_gained' }])
    const { overrides } = buildDispatcher(deps)

    const invalid = await overrides['variants:search'].handle(
      [7, 'stop', '10'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(invalid).toEqual({ error: 'invalid-variant-search' })
    expect(execute).not.toHaveBeenCalled()

    vi.mocked(reply.code).mockClear()
    const result = await overrides['variants:search'].handle(
      [7, 'stop', 10],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, consequence: 'stop_gained' }])
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:search',
      params: [7, 'stop', 10]
    })
  })

  test('variants.columnMeta preserves caseId precedence when both scopes are present', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['variants:columnMeta'].handle(
      [{ caseId: 7, caseIds: [99], columnKey: 'cadd' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'variants:columnMeta',
      params: [{ caseId: 7 }, 'cadd']
    })
  })

  test('variants.query rejects invalid renderer args before storage execution', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['variants:query'].handle(
      [0, {}, 0, 50],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'invalid-case-id', message: 'Invalid case ID' })
    expect(execute).not.toHaveBeenCalled()
  })

  test('transcripts.list delegates to the storage read executor', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce([{ id: 1, transcript_id: 'NM_000059.4' }])
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['transcripts:list'].handle(
      [9],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, transcript_id: 'NM_000059.4' }])
    expect(execute).toHaveBeenCalledWith({ type: 'transcripts:list', params: [9] })
  })

  test('transcripts.switch maps renderer args to the storage write task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['transcripts:switch'].handle(
      [9, 'NM_000059.4'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'transcripts:switch',
      params: [9, 'NM_000059.4']
    })
  })

  test('transcripts.insertAndSwitch maps renderer args to the storage write task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const transcript = {
      transcript_id: 'NM_000059.4',
      gene_symbol: 'BRCA2',
      consequence: 'HIGH',
      cdna: 'c.1A>G',
      aa_change: 'p.M1V',
      hpo_sim_score: 0.8,
      moi: 'AD',
      is_selected: 0
    }

    await overrides['transcripts:insertAndSwitch'].handle(
      [9, transcript],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'transcripts:insertAndSwitch',
      params: [9, transcript]
    })
  })

  test('dispatcher normalizes non-2xx override payloads to SerializableError', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerDispatcher(app, deps, {
      'variants:query': {
        async handle(_args, _request, reply) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/variants/query',
      payload: { args: [0, {}] }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      code: 'UNKNOWN',
      message: 'Invalid case ID',
      userMessage: 'Invalid case ID',
      details: { error: 'invalid-case-id', message: 'Invalid case ID' }
    })
    await app.close()
  })

  test('dispatcher normalizes thrown errors to SerializableError', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerDispatcher(app, deps, {
      'variants:query': {
        async handle() {
          throw new Error('database unavailable')
        }
      },
      'import:start': {
        async handle() {
          return { error: 'upload-not-found' }
        }
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/variants/query',
      payload: { args: [1, {}] }
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      code: 'UNKNOWN',
      message: 'database unavailable',
      userMessage: 'An unexpected error occurred. Please try again.'
    })
    await app.close()
  })

  test('dispatcher preserves duplicate case errors as unique constraint errors', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerDispatcher(app, deps, {
      'import:start': {
        async handle() {
          throw new UniqueConstraintError('case', 'SAMPLE')
        }
      }
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/import/start',
      payload: { args: ['web-upload:1:sample.vcf', 'SAMPLE'] }
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      code: 'UNIQUE_CONSTRAINT',
      message: "case 'SAMPLE' already exists",
      userMessage: "case 'SAMPLE' already exists"
    })
    await app.close()
  })

  test('dispatcher records IPC metrics for overrides, autoroutes, errors, and unknown methods', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    const metrics = new AppMetrics({ app: 'varlens', environment: 'dev' })
    deps.metrics = metrics
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    registerRequestMetrics(app, metrics)
    app.addHook('onRequest', async (request, reply) => {
      if (request.headers['x-block-before-dispatch'] === 'yes') {
        return await reply.code(401).send({
          code: 'UNKNOWN',
          message: 'unauthorized',
          userMessage: 'Unauthorized'
        })
      }
      return undefined
    })
    registerDispatcher(app, deps, {
      'cases:list': {
        async handle() {
          return []
        }
      },
      'variants:query': {
        async handle() {
          throw new Error('database unavailable')
        }
      },
      'import:start': {
        async handle() {
          return { error: 'upload-not-found' }
        }
      }
    })

    const success = await app.inject({
      method: 'POST',
      url: '/api/cases/list',
      payload: { args: [] }
    })
    const read = await app.inject({
      method: 'POST',
      url: '/api/tags/list',
      payload: { args: [] }
    })
    const write = await app.inject({
      method: 'POST',
      url: '/api/tags/create',
      payload: { args: ['Reviewed', '#336699'] }
    })
    const error = await app.inject({
      method: 'POST',
      url: '/api/variants/query',
      payload: { args: [1, {}] }
    })
    const importError = await app.inject({
      method: 'POST',
      url: '/api/import/start',
      payload: { args: ['web-upload:missing/case.vcf', 'Case A'] }
    })
    const preHandlerError = await app.inject({
      method: 'POST',
      url: '/api/auth/isAccountsEnabled',
      headers: { 'x-block-before-dispatch': 'yes' },
      payload: { args: [] }
    })
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/not-a-domain/not-a-method',
      payload: { args: [] }
    })

    expect(success.statusCode).toBe(200)
    expect(read.statusCode).toBe(200)
    expect(write.statusCode).toBe(200)
    expect(error.statusCode).toBe(500)
    expect(importError.statusCode).toBe(200)
    expect(preHandlerError.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(404)
    expect(execute).toHaveBeenCalledWith({ type: 'tags:list', params: [] })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'tags:create',
      params: ['Reviewed', '#336699']
    })

    const text = metrics.metricsText()
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="cases:list",status="success"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="tags:list",status="success"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="tags:create",status="success"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="variants:query",status="error"} 1'
    )
    expect(text).toContain(
      'varlens_operation_events_total{app="varlens",environment="dev",failure_class="upload-not-found",operation="import",result="error"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="auth:isAccountsEnabled",status="error"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_requests_total{app="varlens",environment="dev",ipc="unknown",status="error"} 1'
    )
    expect(text).toContain(
      'varlens_ipc_in_flight{app="varlens",environment="dev",ipc="cases:list"} 0'
    )
    expect(text).toContain('varlens_ipc_in_flight{app="varlens",environment="dev",ipc="unknown"} 0')
    await app.close()
  })

  test('dispatcher audits successful web writes but does not expose audit append as API route', async () => {
    const { deps, writeExecute } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, deps, buildDispatcher(deps).overrides)

    const write = await app.inject({
      method: 'POST',
      url: '/api/tags/create',
      payload: { args: ['Reviewed', '#336699'] }
    })
    const overrideWrite = await app.inject({
      method: 'POST',
      url: '/api/transcripts/switch',
      payload: { args: [9, 'NM_000059.4'] }
    })
    const forgedAudit = await app.inject({
      method: 'POST',
      url: '/api/audit/append',
      payload: {
        args: [
          {
            action_type: 'api_write',
            entity_type: 'api_call',
            entity_key: 'forged'
          }
        ]
      }
    })

    expect(write.statusCode).toBe(200)
    expect(overrideWrite.statusCode).toBe(200)
    expect(forgedAudit.statusCode).toBe(404)
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'tags:create',
      params: ['Reviewed', '#336699']
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'transcripts:switch',
      params: [9, 'NM_000059.4']
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_write',
          entity_type: 'api_call',
          entity_key: 'tags:create',
          old_value: null,
          new_value: { success: true, method: 'tags:create' },
          user_name: 'admin',
          metadata: { source: 'web-dispatcher' }
        }
      ]
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_write',
          entity_type: 'api_call',
          entity_key: 'transcripts:switch',
          old_value: null,
          new_value: { success: true, method: 'transcripts:switch' },
          user_name: 'admin',
          metadata: { source: 'web-dispatcher' }
        }
      ]
    })
    await app.close()
  })

  test('dispatcher audits reads by default and skips explicit technical read exceptions', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, deps, buildDispatcher(deps).overrides)

    const auditedRead = await app.inject({
      method: 'POST',
      url: '/api/tags/list',
      payload: { args: [] }
    })
    const auditedOverrideRead = await app.inject({
      method: 'POST',
      url: '/api/cases/list',
      payload: { args: [] }
    })
    const technicalRead = await app.inject({
      method: 'POST',
      url: '/api/database/getOverview',
      payload: { args: [] }
    })
    const authSessionRead = await app.inject({
      method: 'POST',
      url: '/api/auth/currentUser',
      payload: { args: [] }
    })

    expect(auditedRead.statusCode).toBe(200)
    expect(auditedOverrideRead.statusCode).toBe(200)
    expect(technicalRead.statusCode).toBe(200)
    expect(authSessionRead.statusCode).toBe(200)
    expect(execute).toHaveBeenCalledWith({ type: 'tags:list', params: [] })
    expect(execute).toHaveBeenCalledWith({ type: 'database:overview', params: [] })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_read',
          entity_type: 'api_call',
          entity_key: 'tags:list',
          old_value: null,
          new_value: { success: true, method: 'tags:list' },
          user_name: 'admin',
          metadata: { source: 'web-dispatcher' }
        }
      ]
    })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'audit:append',
      params: [
        {
          action_type: 'api_read',
          entity_type: 'api_call',
          entity_key: 'cases:list',
          old_value: null,
          new_value: { success: true, method: 'cases:list' },
          user_name: 'admin',
          metadata: { source: 'web-dispatcher' }
        }
      ]
    })
    const auditMethods = writeExecute.mock.calls
      .map(([task]) => task)
      .filter((task) => task.type === 'audit:append')
      .map((task) => task.params[0].entity_key)
    expect(auditMethods).toEqual(['tags:list', 'cases:list'])
    await app.close()
  })

  test('dispatcher fails closed when read audit persistence fails', async () => {
    const { deps, execute, writeExecute } = makeDeps()
    writeExecute.mockImplementation(async (task) => {
      if (task.type === 'audit:append') throw new Error('audit unavailable')
      return { task }
    })
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(app, deps, buildDispatcher(deps).overrides)

    const response = await app.inject({
      method: 'POST',
      url: '/api/tags/list',
      payload: { args: [] }
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({
      message: 'audit unavailable',
      userMessage: 'An unexpected error occurred. Please try again.'
    })
    expect(execute).toHaveBeenCalledWith({ type: 'tags:list', params: [] })
    expect(writeExecute).toHaveBeenCalledWith(expect.objectContaining({ type: 'audit:append' }))
    await app.close()
  })

  test('dispatcher does not audit failed writes and fails closed when audit persistence fails', async () => {
    const failedWrite = makeDeps()
    failedWrite.writeExecute.mockImplementation(async (task) => {
      if (task.type === 'tags:create') throw new Error('write unavailable')
      return { task }
    })
    const failedWriteApp = fastify()
    failedWriteApp.setValidatorCompiler(validatorCompiler)
    failedWriteApp.setSerializerCompiler(serializerCompiler)
    failedWriteApp.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(
      failedWriteApp,
      failedWrite.deps,
      buildDispatcher(failedWrite.deps).overrides
    )

    const failedWriteResponse = await failedWriteApp.inject({
      method: 'POST',
      url: '/api/tags/create',
      payload: { args: ['Reviewed', '#336699'] }
    })
    expect(failedWriteResponse.statusCode).toBe(500)
    expect(failedWrite.writeExecute.mock.calls.some(([task]) => task.type === 'audit:append')).toBe(
      false
    )
    await failedWriteApp.close()

    const failedAudit = makeDeps()
    failedAudit.writeExecute.mockImplementation(async (task) => {
      if (task.type === 'audit:append') throw new Error('audit unavailable')
      return { task }
    })
    const failedAuditApp = fastify()
    failedAuditApp.setValidatorCompiler(validatorCompiler)
    failedAuditApp.setSerializerCompiler(serializerCompiler)
    failedAuditApp.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 1, username: 'admin', role: 'admin', passwordChangedAt: null }
      } as never
    })
    registerDispatcher(
      failedAuditApp,
      failedAudit.deps,
      buildDispatcher(failedAudit.deps).overrides
    )

    const failedAuditResponse = await failedAuditApp.inject({
      method: 'POST',
      url: '/api/tags/create',
      payload: { args: ['Reviewed', '#336699'] }
    })
    expect(failedAuditResponse.statusCode).toBe(500)
    expect(failedAuditResponse.json()).toMatchObject({
      message: 'audit unavailable',
      userMessage: 'An unexpected error occurred. Please try again.'
    })
    expect(failedAudit.writeExecute).toHaveBeenCalledWith({
      type: 'tags:create',
      params: ['Reviewed', '#336699']
    })
    expect(failedAudit.writeExecute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audit:append' })
    )
    await failedAuditApp.close()
  })
})
