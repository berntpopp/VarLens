/**
 * Dispatcher error-response hardening (code-scanning alerts #16-#25:
 * js/stack-trace-exposure, js/reflected-xss, js/xss-through-exception).
 *
 * Contract locked here:
 *  - every dispatcher response is `application/json` with `nosniff`, so a
 *    reflected value or exception text can never be rendered as HTML;
 *  - error bodies keep the structured SerializableError fields
 *    (code / message / userMessage / details) but never a stack trace,
 *    whatever shape the thrown value had;
 *  - the 404 body only echoes route params that are plain identifiers.
 */
import { afterEach, describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import {
  sanitizeErrorDetails,
  toSerializableWebError
} from '../../src/web/server/dispatcher-errors'
import { makeDeps } from './helpers/dispatcher-adapters'

const STACK_FRAME = /\n\s+at\s/

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

function buildApp(deps: ReturnType<typeof makeDeps>['deps']): FastifyInstance {
  const instance = fastify()
  instance.setValidatorCompiler(validatorCompiler)
  instance.setSerializerCompiler(serializerCompiler)
  instance.addHook('preHandler', async (request) => {
    request.session = {
      user: { id: 1, username: 'analyst', role: 'user', passwordChangedAt: null }
    } as never
  })
  registerDispatcher(instance, deps, buildDispatcher(deps).overrides)
  return instance
}

function expectJsonHeaders(headers: Record<string, unknown>): void {
  expect(String(headers['content-type'])).toMatch(/^application\/json/)
  expect(headers['x-content-type-options']).toBe('nosniff')
}

function expectNoStack(body: string): void {
  expect(body).not.toContain('"stack"')
  expect(body).not.toMatch(STACK_FRAME)
  expect(body).not.toContain('dispatcher-error-hardening.test')
}

describe('web dispatcher: error responses never expose stack traces', () => {
  test('an Error thrown by a read task becomes a JSON 500 without its stack', async () => {
    const { deps, execute } = makeDeps()
    execute.mockRejectedValueOnce(new Error('boom <img src=x onerror=alert(1)>'))
    app = buildApp(deps)

    const res = await app.inject({
      method: 'POST',
      url: '/api/variants/typeCounts',
      payload: { args: [1] }
    })

    expect(res.statusCode).toBe(500)
    expectJsonHeaders(res.headers)
    expectNoStack(res.body)
    expect(res.json()).toEqual({
      code: 'UNKNOWN',
      message: 'boom <img src=x onerror=alert(1)>',
      userMessage: 'An unexpected error occurred. Please try again.'
    })
  })

  test('an IpcError-shaped Error keeps its structured fields but drops stack and extras', async () => {
    const { deps, writeExecute } = makeDeps()
    const thrown = Object.assign(new Error('constraint failed'), {
      code: 'UNIQUE_CONSTRAINT',
      userMessage: 'Already exists.',
      details: { table: 'gene_lists', stack: 'Error: inner\n    at secret.ts:1:1' },
      sql: 'INSERT INTO secret_table VALUES ($1)'
    })
    writeExecute.mockRejectedValueOnce(thrown)
    app = buildApp(deps)

    const res = await app.inject({
      method: 'POST',
      url: '/api/geneLists/create',
      payload: { args: [{ name: 'x' }] }
    })

    // The legacy UNIQUE_CONSTRAINT code maps to 409 like CONFLICT.
    expect(res.statusCode).toBe(409)
    expectJsonHeaders(res.headers)
    expectNoStack(res.body)
    expect(res.body).not.toContain('secret_table')
    expect(res.json()).toEqual({
      code: 'UNIQUE_CONSTRAINT',
      message: 'constraint failed',
      userMessage: 'Already exists.',
      details: { table: 'gene_lists' }
    })
  })

  test('a thrown plain object is reduced to JSON-safe details with nested errors flattened', async () => {
    const { deps, execute } = makeDeps()
    const inner = new Error('inner failure')
    execute.mockRejectedValueOnce({
      message: 'outer failure',
      stack: 'Error: outer\n    at leak.ts:9:9',
      cause: inner,
      nested: { stack: 'x\n    at deep.ts:1:1', ok: 1 }
    })
    app = buildApp(deps)

    const res = await app.inject({
      method: 'POST',
      url: '/api/variants/typeCounts',
      payload: { args: [1] }
    })

    expect(res.statusCode).toBe(500)
    expectJsonHeaders(res.headers)
    expectNoStack(res.body)
    expect(res.json()).toEqual({
      code: 'UNKNOWN',
      message: 'outer failure',
      userMessage: 'outer failure',
      details: {
        message: 'outer failure',
        cause: { name: 'Error', message: 'inner failure' },
        nested: { ok: 1 }
      }
    })
  })

  test('a successful response is served as JSON with nosniff', async () => {
    const { deps } = makeDeps()
    app = buildApp(deps)

    const res = await app.inject({
      method: 'POST',
      url: '/api/variants/typeCounts',
      payload: { args: ['<script>alert(1)</script>'] }
    })

    expect(res.statusCode).toBe(200)
    expectJsonHeaders(res.headers)
    expect(res.json()).toEqual({
      task: { type: 'variants:typeCounts', params: ['<script>alert(1)</script>'] }
    })
  })

  test('404 echoes plain identifiers but drops anything that is not one', async () => {
    const { deps } = makeDeps()
    app = buildApp(deps)

    const plain = await app.inject({ method: 'POST', url: '/api/nope/missingMethod' })
    expect(plain.statusCode).toBe(404)
    expectJsonHeaders(plain.headers)
    expect(plain.json()).toMatchObject({
      code: 'NOT_FOUND',
      details: { domain: 'nope', method: 'missingMethod' }
    })

    const hostile = await app.inject({
      method: 'POST',
      url: `/api/nope/${encodeURIComponent('<svg onload=alert(1)>')}`
    })
    expect(hostile.statusCode).toBe(404)
    expectJsonHeaders(hostile.headers)
    expect(hostile.body).not.toContain('<svg')
    expect(hostile.json()).toEqual({
      code: 'NOT_FOUND',
      message: 'unknown method',
      userMessage: 'Unknown API method.',
      details: { domain: 'nope' }
    })
  })
})

describe('dispatcher-errors helpers', () => {
  test('toSerializableWebError never returns the thrown object itself', () => {
    const thrown = Object.assign(new Error('x'), { code: 'NOT_FOUND', userMessage: 'y' })
    const out = toSerializableWebError(thrown)
    expect(out).not.toBe(thrown)
    expect(Object.keys(out).sort()).toEqual(['code', 'message', 'userMessage'])
  })

  test('unknown error codes collapse to UNKNOWN', () => {
    const out = toSerializableWebError({ code: 'EVIL', message: 'm', userMessage: 'u' })
    expect(out.code).toBe('UNKNOWN')
  })

  test('sanitizeErrorDetails bounds depth and drops functions and stacks', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
    const out = sanitizeErrorDetails({
      deep,
      fn: () => 1,
      stack: 's',
      list: [1, 'two', { stack: 'z' }]
    })
    expect(out).toEqual({
      deep: { a: { b: { c: '[truncated]' } } },
      list: [1, 'two', {}]
    })
  })

  test('sanitizeErrorDetails returns undefined for non-objects', () => {
    expect(sanitizeErrorDetails(undefined)).toBeUndefined()
    expect(sanitizeErrorDetails('text')).toBeUndefined()
  })
})
