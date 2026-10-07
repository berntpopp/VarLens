import { afterAll, describe, expect, test, vi } from 'vitest'

import { buildGeneListOverrides } from '../../src/web/server/routes/gene-lists'
import { buildPanelOverrides } from '../../src/web/server/routes/panels'
import { buildGeneRefOverrides } from '../../src/web/server/routes/gene-ref'
import { closeWebGeneReferenceDb } from '../../src/web/server/web-gene-reference'
import { makeDeps } from './helpers/dispatcher-adapters'

/**
 * Gene Panels in web mode: gene-ref info and symbol validation/autocomplete
 * read the bundled resources/gene_reference.db (previously 501 unless the
 * parity-fixture mode was on, and 404 for validate/autocomplete).
 */
describe('web gene panel routes', () => {
  afterAll(() => closeWebGeneReferenceDb())
  const request = { session: { user: { id: 1, username: 'admin', role: 'admin' } } }

  test('gene-ref:info serves the bundled reference without fixture mode', async () => {
    const { deps, reply } = makeDeps()
    const info = (await buildGeneRefOverrides()['gene-ref:info'].handle(
      [],
      request as never,
      reply as never,
      deps
    )) as { geneCount: number; assemblies: string[] }
    expect(reply.code).not.toHaveBeenCalled()
    expect(info.geneCount).toBeGreaterThan(1000)
    expect(info.assemblies).toContain('GRCh38')
  })

  test('panels:validateSymbols resolves approved and unknown symbols', async () => {
    const { deps, reply } = makeDeps()
    const result = (await buildPanelOverrides()['panels:validateSymbols'].handle(
      [['brca1', 'NOTAGENE']],
      request as never,
      reply as never,
      deps
    )) as Array<{ status: string; symbol?: string }>
    expect(result[0]).toMatchObject({ status: 'approved', symbol: 'BRCA1' })
    expect(result[1]).toMatchObject({ status: 'unknown' })
  })

  test('panels:autocomplete accepts a null limit from JSON and uses FTS5', async () => {
    const { deps, reply } = makeDeps()
    const result = (await buildPanelOverrides()['panels:autocomplete'].handle(
      ['BRCA', null],
      request as never,
      reply as never,
      deps
    )) as Array<{ symbol: string }>
    expect(reply.code).not.toHaveBeenCalled()
    expect(result.map((r) => r.symbol)).toContain('BRCA1')
  })

  test('panels:autocomplete rejects an empty query with 400', async () => {
    const { deps, reply } = makeDeps()
    reply.code = vi.fn()
    await buildPanelOverrides()['panels:autocomplete'].handle(
      [''],
      request as never,
      reply as never,
      deps
    )
    expect(reply.code).toHaveBeenCalledWith(400)
  })

  test('panels:resolutionStatus validates the request and runs the read-executor task', async () => {
    const { deps, reply, execute } = makeDeps()
    const result = await buildPanelOverrides()['panels:resolutionStatus'].handle(
      [{ panelIds: [3, 4], caseId: 9 }],
      request as never,
      reply as never,
      deps
    )
    expect(reply.code).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({
      type: 'panels:resolutionStatus',
      params: [{ panelIds: [3, 4], caseId: 9 }]
    })
    expect(result).toEqual({
      task: { type: 'panels:resolutionStatus', params: [{ panelIds: [3, 4], caseId: 9 }] }
    })
  })

  test('panels:resolutionStatus rejects a malformed request with 400', async () => {
    for (const bad of [undefined, { panelIds: ['x'] }, { panelIds: [1], caseId: -1 }]) {
      const { deps, reply, execute } = makeDeps()
      reply.code = vi.fn()
      await buildPanelOverrides()['panels:resolutionStatus'].handle(
        [bad],
        request as never,
        reply as never,
        deps
      )
      expect(reply.code).toHaveBeenCalledWith(400)
      expect(execute).not.toHaveBeenCalled()
    }
  })

  test('gene-lists:setGenes rejects symbols the gene reference does not know', async () => {
    const { deps, reply, writeExecute } = makeDeps()
    reply.code = vi.fn()
    const result = await buildGeneListOverrides()['gene-lists:setGenes'].handle(
      [3, ['BRCA1', 'NOTAGENE1']],
      request as never,
      reply as never,
      deps
    )
    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toMatchObject({ error: 'unknown-gene-symbols', unknown: ['NOTAGENE1'] })
    expect(writeExecute).not.toHaveBeenCalled()
  })
})
