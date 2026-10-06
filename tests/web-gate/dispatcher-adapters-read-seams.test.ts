import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import { buildHpoFixtureResponse } from '../../src/web/server/api-fixture-responses'
import { makeDeps } from './helpers/dispatcher-adapters'

describe('web dispatcher adapters: read seams', () => {
  test('panels.get returns the desktop panel-plus-genes shape', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce({ id: 5, name: 'Cancer panel' })
    execute.mockResolvedValueOnce([{ symbol: 'BRCA1', hgnc_id: 'HGNC:1100' }])
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['panels:get'].handle([5], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: 5,
      name: 'Cancer panel',
      genes: [{ symbol: 'BRCA1', hgnc_id: 'HGNC:1100' }]
    })
    expect(execute).toHaveBeenNthCalledWith(1, { type: 'panels:get', params: [5] })
    expect(execute).toHaveBeenNthCalledWith(2, { type: 'panels:getGenes', params: [5] })
  })

  test('panels.update maps renderer object args to the storage task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['panels:update'].handle(
      [{ id: 5, name: 'Updated panel', description: null }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'panels:update',
      params: [5, { name: 'Updated panel', description: null, version: undefined }]
    })
  })

  test('database.info returns a safe web workspace identity for renderer startup', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['database:info'].handle([], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      path: 'web:postgres',
      name: 'VarLens Web',
      encrypted: false
    })
  })

  test('cases.list delegates to the web storage session', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cases:list'].handle([], {} as never, reply as never, deps)

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([{ id: 1, name: 'Case A' }])
    expect(deps.session.listCases).toHaveBeenCalledTimes(1)
  })

  test('cases.delete publishes cohort refresh events after the storage write', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['cases:delete'].handle(
      [7],
      { session: { user: { id: 12 } } } as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({ type: 'cases:delete', params: [7] })
    expect(deps.events.publish).toHaveBeenCalledWith(12, 'cohort:summaryRebuilt', {
      is_stale: true
    })
    expect(deps.events.publish).toHaveBeenCalledWith(12, 'cohort:summaryRebuilt', {
      is_stale: false
    })
  })

  test('cohort.getVariants maps preload method name to cohort:query', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['cohort:getVariants'].handle(
      [{ limit: 25, offset: 10, search_term: 'BRCA1', sort_order: 'desc' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    // Shared cohort logic defaults genome_build to GRCh38 (desktop parity) before
    // dispatching the cohort:query read.
    expect(execute).toHaveBeenCalledWith({
      type: 'cohort:query',
      params: [
        {
          limit: 25,
          offset: 10,
          search_term: 'BRCA1',
          sort_order: 'desc',
          genome_build: 'GRCh38'
        }
      ]
    })
  })

  test('cohort.getVariants rejects invalid renderer args before storage execution', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:getVariants'].handle(
      [{ limit: -1 }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({
      error: 'invalid-cohort-params',
      message: 'Invalid cohort search parameters'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('cohort read helpers map preload method names to storage task names', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['cohort:getSummary'].handle([], {} as never, reply as never, deps)
    await overrides['cohort:getColumnMeta'].handle([], {} as never, reply as never, deps)
    await overrides['cohort:getGeneBurden'].handle([], {} as never, reply as never, deps)
    await overrides['cohort:getCarriers'].handle(
      ['chr22', 12345, 'A', 'T'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:summary', params: [] })
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:columnMeta', params: [] })
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:geneBurden', params: [] })
    expect(execute).toHaveBeenCalledWith({
      type: 'cohort:carriers',
      params: ['chr22', 12345, 'A', 'T']
    })
  })

  test('database.recentList returns an empty desktop-file list in web mode', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['database:recentList'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  test('database.capabilities reports export as supported (served as browser downloads)', async () => {
    const { deps, reply } = makeDeps()
    ;(deps.session as { capabilities: unknown }).capabilities = {
      backend: 'postgres',
      export: { variants: true, cohort: true, streaming: true }
    }
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['database:capabilities'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      backend: 'postgres',
      export: { variants: true, cohort: true, streaming: true }
    })
  })

  test('web-only unsupported cohort actions fail explicitly', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:runAssociation'].handle(
      [{}],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'cohort.runAssociation',
      message: 'cohort.runAssociation is not available in web mode yet.'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('external reference lookups answer 501 when the server has no ReferenceServices', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['vep:fetch'].handle(
      ['chr1', 100, 'A', 'T'],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'vep:fetch',
      message: 'vep:fetch is not available in web mode yet.'
    })
  })

  test('reference API fixture-backed methods reject invalid args as bad requests', async () => {
    const previousFixtureFlag = process.env.VARLENS_WEB_PARITY_FIXTURES
    const previousFixtureDir = process.env.VARLENS_API_FIXTURES_DIR
    process.env.VARLENS_WEB_PARITY_FIXTURES = '1'
    process.env.VARLENS_API_FIXTURES_DIR = process.cwd()

    try {
      const cases = [
        {
          key: 'hpo:search',
          args: [123],
          expected: {
            error: 'invalid-hpo-search',
            message: 'hpo.search query must be a 1-500 character string; maxResults 1-100'
          }
        },
        {
          key: 'vep:fetch',
          args: ['chr1', 'not-a-position', 'A', 'T'],
          expected: {
            error: 'invalid-vep-fetch',
            message: 'Invalid vep.fetch parameters'
          }
        },
        {
          key: 'protein:getMapping',
          args: [123],
          expected: {
            error: 'invalid-protein-gene',
            message: 'gene symbol must be a string'
          }
        },
        {
          key: 'protein:getDomains',
          args: [123],
          expected: {
            error: 'invalid-protein-accession',
            message: 'UniProt accession must be a string'
          }
        }
      ] as const

      for (const entry of cases) {
        const { deps, execute, reply } = makeDeps()
        const { overrides } = buildDispatcher(deps)

        const result = await overrides[entry.key].handle(
          entry.args,
          {} as never,
          reply as never,
          deps
        )

        expect(reply.code, entry.key).toHaveBeenCalledWith(400)
        expect(result, entry.key).toEqual(entry.expected)
        expect(execute, entry.key).not.toHaveBeenCalled()
      }
    } finally {
      if (previousFixtureFlag === undefined) delete process.env.VARLENS_WEB_PARITY_FIXTURES
      else process.env.VARLENS_WEB_PARITY_FIXTURES = previousFixtureFlag
      if (previousFixtureDir === undefined) delete process.env.VARLENS_API_FIXTURES_DIR
      else process.env.VARLENS_API_FIXTURES_DIR = previousFixtureDir
    }
  })

  test('reference API fixture reader rejects paths outside the fixture root', () => {
    const previousFixtureFlag = process.env.VARLENS_WEB_PARITY_FIXTURES
    const previousFixtureDir = process.env.VARLENS_API_FIXTURES_DIR
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'varlens-web-api-fixtures-'))
    process.env.VARLENS_WEB_PARITY_FIXTURES = '1'
    process.env.VARLENS_API_FIXTURES_DIR = fixtureRoot

    try {
      expect(() => buildHpoFixtureResponse('x/../../../outside')).toThrow(/fixture root/i)
    } finally {
      if (previousFixtureFlag === undefined) delete process.env.VARLENS_WEB_PARITY_FIXTURES
      else process.env.VARLENS_WEB_PARITY_FIXTURES = previousFixtureFlag
      if (previousFixtureDir === undefined) delete process.env.VARLENS_API_FIXTURES_DIR
      else process.env.VARLENS_API_FIXTURES_DIR = previousFixtureDir
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  test('cohort.getSummaryStatus delegates to the storage read executor for web Postgres', async () => {
    const { deps, execute, reply } = makeDeps()
    execute.mockResolvedValueOnce({ is_stale: false, last_rebuilt_at: 0 })
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['cohort:getSummaryStatus'].handle(
      [],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({ type: 'cohort:summaryStatus', params: [] })
    expect(result).toEqual({ is_stale: false, last_rebuilt_at: 0 })
  })
})
