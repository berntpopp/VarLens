/**
 * Issue #514: every executor auto-route validates its arguments. A task type
 * added to task-types.ts without a schema (or an override) fails here.
 */
import { describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { AUTO_ROUTE_ARG_SCHEMAS } from '../../src/web/server/auto-route-schemas'
import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { READ_TASK_TYPES, WRITE_TASK_TYPES } from '../../src/web/server/task-types'
import { makeDeps, withSession } from './helpers/dispatcher-adapters'

function buildApp(deps: ReturnType<typeof makeDeps>['deps']): FastifyInstance {
  const app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  withSession(app as never)
  registerDispatcher(app, deps, buildDispatcher(deps).overrides)
  return app
}

async function call(path: string, args: unknown[]) {
  const made = makeDeps()
  const app = buildApp(made.deps)
  const response = await app.inject({ method: 'POST', url: `/api/${path}`, payload: { args } })
  await app.close()
  return { response, ...made }
}

describe('web dispatcher: auto-route argument schemas', () => {
  const overrides = buildDispatcher(makeDeps().deps).overrides
  const autoRoutes = [...READ_TASK_TYPES, ...WRITE_TASK_TYPES].filter(
    (key) => overrides[key] === undefined
  )

  test('every auto-route has an argument schema', () => {
    expect(autoRoutes.filter((key) => AUTO_ROUTE_ARG_SCHEMAS[key] === undefined)).toEqual([])
  })

  test('the schema table lists auto-routes only', () => {
    const served = new Set<string>(autoRoutes)
    expect(Object.keys(AUTO_ROUTE_ARG_SCHEMAS).filter((key) => !served.has(key))).toEqual([])
  })

  test.each<[string, unknown[]]>([
    ['case-metadata/get', [{}]],
    ['case-metadata/get', [-1]],
    ['case-metadata/get', ['1']],
    ['case-metadata/get', []],
    ['case-metadata/get', [1, 2]],
    ['case-metadata/setCohorts', [1, Array.from({ length: 10_001 }, () => 1)]],
    ['variants/typeCounts', [1.5]],
    ['variants/geneSymbols', [1, 'BRCA', 100_000]],
    ['variants/shortlist', [{}]],
    ['tags/list', [{}]],
    ['tags/getUsageCount', [0]],
    ['annotations/getPerCase', [1, null]],
    ['case-comments/list', [{}]],
    ['case-metrics/listForCase', ['x']],
    ['panels/getGenes', [{}]],
    ['gene-lists/getGenes', [-3]],
    ['presets/list', [{}]],
    ['analysis-groups/get', [{}]]
  ])('read %s rejects %j with 400 before the executor', async (path, args) => {
    const { response, execute, writeExecute } = await call(path, args)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'INVALID_PARAMETERS' })
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
  })

  test.each<[string, unknown[]]>([
    ['case-metadata/upsert', [1, { age: 'old' }]],
    ['case-metadata/assignHpoTerm', [1, '', 'Seizure']],
    ['tags/create', [{}]],
    ['tags/setVariantTags', [1, 2, Array.from({ length: 10_001 }, () => 1)]],
    ['tags/setVariantTags', [1, 2, [-1]]],
    ['case-comments/create', [1, 'Not a category', 'text']],
    ['case-metrics/delete', [1]],
    ['panels/activate', [1, 2, -5]],
    ['panels/setGenes', [1, [{ hgncId: '', symbol: 'A' }]]],
    ['gene-lists/create', ['x'.repeat(201)]],
    ['region-files/delete', [{}]],
    ['presets/reorder', [[{ id: 1 }]]],
    ['analysis-groups/update', [1, { name: '' }]]
  ])('write %s rejects %j with 400 before the executor', async (path, args) => {
    const { response, execute, writeExecute } = await call(path, args)
    expect(response.statusCode).toBe(400)
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
  })

  test('valid arguments reach the executor as the task params', async () => {
    const read = await call('case-metadata/get', [7])
    expect(read.response.statusCode).toBe(200)
    expect(read.execute).toHaveBeenCalledWith({ type: 'case-metadata:get', params: [7] })

    const write = await call('tags/create', ['Reviewed', '#00ff00'])
    expect(write.response.statusCode).toBe(200)
    expect(write.writeExecute).toHaveBeenCalledWith({
      type: 'tags:create',
      params: ['Reviewed', '#00ff00']
    })
  })

  test('an omitted or null optional argument gets the desktop default', async () => {
    const symbols = await call('variants/geneSymbols', [1, 'BRCA'])
    expect(symbols.execute).toHaveBeenCalledWith({
      type: 'variants:geneSymbols',
      params: [1, 'BRCA', 50]
    })
    const activate = await call('panels/activate', [1, 2, null])
    expect(activate.writeExecute).toHaveBeenCalledWith({
      type: 'panels:activate',
      params: [1, 2, 5000]
    })
  })

  test('unknown keys of an update object do not reach the executor', async () => {
    const { writeExecute } = await call('case-metadata/upsert', [1, { sex: 'female', id: 99 }])
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'case-metadata:upsert',
      params: [1, { sex: 'female' }]
    })
  })
})
