import fastify from 'fastify'
import { afterAll, describe, expect, test, vi } from 'vitest'

import {
  PANEL_BED_DOWNLOAD_PATH,
  registerPanelBedDownloadRoute
} from '../../src/web/server/panel-bed-download'
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

  test('panels:exportBed over RPC validates the export and returns the download URL', async () => {
    const { deps, reply, execute } = makeDeps()
    execute.mockImplementation(async (task: { type: string }) =>
      task.type === 'panels:get'
        ? { id: 5, name: 'Breast cancer' }
        : [{ hgnc_id: 'HGNC:1100', symbol: 'BRCA1' }]
    )
    const result = await buildPanelOverrides()['panels:exportBed'].handle(
      [5, 'GRCh38', null],
      request as never,
      reply as never,
      deps
    )
    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      path: `${PANEL_BED_DOWNLOAD_PATH}?panelId=5&assembly=GRCh38&paddingBp=0`
    })
  })
})

describe('web panel BED download', () => {
  afterAll(() => closeWebGeneReferenceDb())

  function buildApp(session: unknown) {
    const harness = makeDeps()
    harness.execute.mockImplementation(async (task: { type: string; params: unknown[] }) => {
      if (task.type === 'panels:get') {
        return task.params[0] === 5 ? { id: 5, name: 'Breast cancer' } : null
      }
      if (task.type === 'panels:getGenes') return [{ hgnc_id: 'HGNC:1100', symbol: 'BRCA1' }]
      return null
    })
    const app = fastify()
    app.addHook('preHandler', async (req) => {
      req.session = session as never
    })
    registerPanelBedDownloadRoute(app, harness.deps)
    return { app, ...harness }
  }

  const SIGNED_IN = { user: { id: 1, username: 'analyst', role: 'user' } }

  test('streams BED intervals as an attachment and audits the read', async () => {
    const { app, writeExecute } = buildApp(SIGNED_IN)
    try {
      const res = await app.inject({
        method: 'GET',
        url: `${PANEL_BED_DOWNLOAD_PATH}?panelId=5&assembly=GRCh38&paddingBp=100`
      })
      expect(res.statusCode, res.body).toBe(200)
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="Breast_cancer_GRCh38.bed"'
      )
      const lines = res.body.trim().split('\n')
      expect(lines[0]).toContain('track name="Breast cancer"')
      expect(lines[1]).toMatch(/^chr17\t\d+\t\d+\tBRCA1$/)
      expect(writeExecute).toHaveBeenCalledWith(expect.objectContaining({ type: 'audit:append' }))
    } finally {
      await app.close()
    }
  })

  test('unknown panel 404, bad params 400, anonymous 401', async () => {
    const { app } = buildApp(SIGNED_IN)
    const anonymous = buildApp({})
    try {
      const missing = await app.inject({
        method: 'GET',
        url: `${PANEL_BED_DOWNLOAD_PATH}?panelId=99&assembly=GRCh38`
      })
      expect(missing.statusCode).toBe(404)
      const bad = await app.inject({
        method: 'GET',
        url: `${PANEL_BED_DOWNLOAD_PATH}?panelId=abc&assembly=GRCh38`
      })
      expect(bad.statusCode).toBe(400)
      const anon = await anonymous.app.inject({
        method: 'GET',
        url: `${PANEL_BED_DOWNLOAD_PATH}?panelId=5&assembly=GRCh38`
      })
      expect(anon.statusCode).toBe(401)
    } finally {
      await app.close()
      await anonymous.app.close()
    }
  })
})
