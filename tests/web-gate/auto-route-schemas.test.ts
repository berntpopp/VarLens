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

  // One argument list per auto-route, as the renderer passes it to `window.api`
  // (the web client forwards those arguments unchanged as `args`).
  const REAL_CALLS: Array<[string, unknown[]]> = [
    ['cases:availableBuilds', []],
    ['case-metadata:get', [7]],
    ['case-metadata:listCohorts', []],
    ['case-metadata:getCohortByName', ['Epilepsy trios']],
    ['case-metadata:getCaseCohorts', [7]],
    ['case-metadata:getHpoTerms', [7]],
    ['case-metadata:getDataInfo', [7]],
    ['case-metadata:listExternalIds', [7]],
    ['case-metadata:distinctHpoTerms', []],
    ['case-metadata:distinctPlatforms', []],
    ['case-metadata:distinctExternalIdTypes', []],
    ['case-metadata:getFullMetadata', [7]],
    ['case-metadata:upsert', [7, { affected_status: 'affected' }]],
    ['case-metadata:updateCohort', [3, { name: 'Epilepsy trios', description: null }]],
    ['case-metadata:deleteCohort', [3]],
    ['case-metadata:assignCohort', [7, 3]],
    ['case-metadata:removeCohort', [7, 3]],
    ['case-metadata:setCohorts', [7, [3, 4]]],
    ['case-metadata:assignHpoTerm', [7, 'HP:0001250', 'Seizure']],
    ['case-metadata:removeHpoTerm', [7, 'HP:0001250']],
    [
      'case-metadata:upsertDataInfo',
      [
        7,
        {
          platform: 'Exome',
          platform_details: null,
          af_filter: '<1%',
          quality_filter: null,
          data_notes: null,
          gene_list_id: null,
          region_file_id: 2
        }
      ]
    ],
    ['case-metadata:upsertExternalId', [7, 'Lab ID', 'L-2024-0815']],
    ['case-metadata:deleteExternalId', [7, 'Lab ID']],
    ['variants:typeCounts', [7]],
    ['variants:typesPresent', [{ caseIds: [7, 8] }]],
    ['variants:geneSymbols', [7, 'BRC', 50]],
    ['variants:shortlist', [{ caseId: 7, presetId: 4 }]],
    ['tags:list', []],
    ['tags:getUsageCount', [5]],
    ['tags:getVariantTags', [7, 1234]],
    ['tags:create', ['Reviewed', '#00ff00']],
    ['tags:update', [5, { name: 'Reviewed', color: '#00ff00' }]],
    ['tags:delete', [5]],
    ['tags:assignVariantTag', [7, 1234, 5]],
    ['tags:removeVariantTag', [7, 1234, 5]],
    ['tags:setVariantTags', [7, 1234, [5, 6]]],
    ['annotations:getPerCase', [7, 1234]],
    ['annotations:deletePerCase', [7, 1234]],
    [
      'annotations:batchGet',
      [7, [{ chr: 'chr17', pos: 43045712, ref: 'T', alt: 'C', variantId: 1234 }]]
    ],
    // Cohort scope: no case, coordinate-only keys.
    ['annotations:batchGet', [null, [{ chr: '17', pos: 43045712, ref: 'T', alt: 'C' }]]],
    ['case-comments:list', [7]],
    ['case-comments:create', [7, 'Clinical Note', 'Seizures since age 2.']],
    ['case-comments:update', [11, 'Seizures since age 3.']],
    ['case-comments:delete', [11]],
    ['case-metrics:listDefinitions', []],
    ['case-metrics:listForCase', [7]],
    ['case-metrics:createDefinition', ['Mean coverage', 'numeric', 'x', 'Sequencing']],
    ['case-metrics:upsert', [7, 2, { numeric_value: 104.5 }]],
    ['case-metrics:delete', [7, 2]],
    ['panels:list', []],
    ['panels:getGenes', [9]],
    ['panels:activeForCase', [7]],
    ['panels:delete', [9]],
    ['panels:duplicate', [9, 'Epilepsy (copy)']],
    ['panels:setGenes', [9, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }]]],
    ['panels:activate', [7, 9, 5000]],
    ['panels:deactivate', [7, 9]],
    ['gene-lists:list', []],
    ['gene-lists:getGenes', [2]],
    ['gene-lists:create', ['Epilepsy genes', null]],
    ['gene-lists:delete', [2]],
    ['region-files:list', []],
    ['region-files:create', ['Exome targets v8', 'Vendor BED']],
    ['region-files:delete', [2]],
    ['presets:list', []],
    [
      'presets:create',
      [{ name: 'Rare HIGH', description: null, filterJson: { consequence: ['HIGH'] } }]
    ],
    ['presets:update', [4, { isVisible: false }]],
    ['presets:delete', [4]],
    [
      'presets:reorder',
      [
        [
          { id: 4, sortOrder: 0 },
          { id: 5, sortOrder: 1 }
        ]
      ]
    ],
    ['analysis-groups:list', []],
    ['analysis-groups:get', [6]],
    ['analysis-groups:getForCase', [7]],
    ['analysis-groups:update', [6, { name: 'Family 12', description: null }]],
    ['analysis-groups:delete', [6]],
    ['analysis-groups:removeMember', [6, 7]]
  ]

  test.each(REAL_CALLS)('%s accepts the arguments of a real call: %j', (key, args) => {
    // Through JSON, as on the wire.
    const parsed = AUTO_ROUTE_ARG_SCHEMAS[key].safeParse(JSON.parse(JSON.stringify(args)))
    expect(parsed.error?.issues).toBeUndefined()
  })

  test('the real-call table covers every schema', () => {
    expect([...new Set(REAL_CALLS.map(([key]) => key))].sort()).toEqual(
      Object.keys(AUTO_ROUTE_ARG_SCHEMAS).sort()
    )
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
