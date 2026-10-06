import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'

import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  COHORT_EXPORT_DOWNLOAD_PATH,
  registerExportDownloadRoutes,
  VARIANT_EXPORT_DOWNLOAD_PATH
} from '../../src/web/server/routes/export-download'
import { makeDeps } from './helpers/dispatcher-adapters'

type Row = Record<string, unknown>

interface SessionStub {
  user?: { id: number; username: string; role: string; passwordChangedAt: string | null }
  mustChangePassword?: boolean
}

const ADMIN: SessionStub = {
  user: { id: 7, username: 'admin', role: 'admin', passwordChangedAt: null }
}

/** Row source that records whether its consumer released it early. */
function trackedRows(rows: Row[], options: { endless?: boolean } = {}) {
  const state = { released: false, yielded: 0 }
  async function* generate(): AsyncGenerator<Row> {
    try {
      let index = 0
      while (options.endless === true || index < rows.length) {
        state.yielded += 1
        yield rows[index % rows.length]
        index += 1
      }
    } finally {
      state.released = true
    }
  }
  return { iterable: generate(), state }
}

function buildApp(session: SessionStub, rowsFor: (type: string) => AsyncIterable<Row>) {
  const harness = makeDeps()
  harness.execute.mockImplementation(async (task: { type: string }) => rowsFor(task.type))
  const app = fastify()
  app.addHook('preHandler', async (request) => {
    request.session = session as never
  })
  registerExportDownloadRoutes(app, harness.deps)
  return { app, ...harness }
}

const VARIANT_ROWS: Row[] = [
  {
    chr: 'chr22',
    pos: 100,
    ref: 'A',
    alt: 'G',
    gene_symbol: 'COMT',
    gnomad_af: 0.000123,
    cadd: 25.456
  },
  { chr: 'chr22', pos: 200, ref: 'C', alt: 'T', gene_symbol: 'A,B "quoted"', consequence: 'HIGH' }
]

let openApp: FastifyInstance | undefined
afterEach(async () => {
  await openApp?.close()
  openApp = undefined
})

describe('web export download routes', () => {
  test('streams the case variant CSV as an attachment with filters forwarded', async () => {
    const source = trackedRows(VARIANT_ROWS)
    const { app, execute, writeExecute } = buildApp(ADMIN, () => source.iterable)
    openApp = app

    const filters = { consequences: ['HIGH'], gene_symbol: 'COMT' }
    const query = new URLSearchParams({
      caseId: '3',
      caseName: 'Case A/1',
      filters: JSON.stringify(filters)
    })
    const res = await app.inject({ method: 'GET', url: `${VARIANT_EXPORT_DOWNLOAD_PATH}?${query}` })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toBe('attachment; filename="Case_A_1_variants.csv"')
    expect(res.headers['cache-control']).toBe('no-store')
    const lines = res.body.split('\r\n')
    expect(lines[0]).toBe(
      'Chromosome,Position,Reference,Alternate,Genotype,Gene,Function,Consequence,Transcript,' +
        'cDNA,AA Change,gnomAD AF,CADD,Quality,ClinVar,HPO Similarity,MOI'
    )
    expect(lines[1]).toBe('chr22,100,A,G,,COMT,,,,,,1.23e-4,25.46,,,,')
    expect(lines[2]).toContain('"A,B ""quoted"""')
    expect(lines).toHaveLength(4) // header + 2 rows + trailing ''
    expect(execute).toHaveBeenCalledWith({
      type: 'export:variants',
      params: [{ ...filters, case_id: 3 }]
    })
    expect(writeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audit:append',
        params: [
          expect.objectContaining({ action_type: 'api_read', entity_key: 'export:variants' })
        ]
      })
    )
    expect(source.state.released).toBe(true)
  })

  test('streams the cohort CSV with validated params', async () => {
    const rows = [{ chr: 'chr1', pos: 5, gene_symbol: 'TP53', cohort_frequency: 0.5 }]
    const { app, execute } = buildApp(ADMIN, () => trackedRows(rows).iterable)
    openApp = app

    const params = { gene_symbol: 'TP53', limit: 25 }
    const res = await app.inject({
      method: 'GET',
      url: `${COHORT_EXPORT_DOWNLOAD_PATH}?params=${encodeURIComponent(JSON.stringify(params))}`
    })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="cohort_variants_\d{4}-\d{2}-\d{2}\.csv"$/
    )
    expect(res.body.split('\r\n')[0]).toMatch(/^Chromosome,Position,Reference,Alternate,Gene,/)
    expect(res.body).toContain('chr1,5,,,TP53')
    expect(execute).toHaveBeenCalledWith({ type: 'export:cohort', params: [params] })
  })

  test('rejects anonymous and pre-rotation sessions before touching storage', async () => {
    const anon = buildApp({}, () => trackedRows([]).iterable)
    openApp = anon.app
    const res = await anon.app.inject({
      method: 'GET',
      url: `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=1&caseName=x`
    })
    expect(res.statusCode).toBe(401)
    expect(anon.execute).not.toHaveBeenCalled()
    await anon.app.close()

    const rotating = buildApp(
      { ...ADMIN, mustChangePassword: true },
      () => trackedRows([]).iterable
    )
    openApp = rotating.app
    const res2 = await rotating.app.inject({ method: 'GET', url: COHORT_EXPORT_DOWNLOAD_PATH })
    expect(res2.statusCode).toBe(403)
    expect(rotating.execute).not.toHaveBeenCalled()
  })

  test.each([
    ['missing case name', `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=1`],
    ['non-numeric case id', `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=abc&caseName=x`],
    ['malformed filters JSON', `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=1&caseName=x&filters=%7B`],
    [
      'out-of-range filter',
      `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=1&caseName=x&filters=${encodeURIComponent('{"gnomad_af_max":7}')}`
    ],
    ['malformed cohort JSON', `${COHORT_EXPORT_DOWNLOAD_PATH}?params=nope`],
    [
      'invalid cohort params',
      `${COHORT_EXPORT_DOWNLOAD_PATH}?params=${encodeURIComponent('{"limit":-1}')}`
    ]
  ])('returns 400 for %s', async (_label, url) => {
    const { app, execute, writeExecute } = buildApp(ADMIN, () => trackedRows([]).iterable)
    openApp = app
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode, res.body).toBe(400)
    expect(res.json()).toMatchObject({ code: 'INVALID_PARAMETERS' })
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
  })

  test('a query that fails before the first row returns a JSON 500, not a truncated file', async () => {
    async function* failing(): AsyncGenerator<Row> {
      yield* []
      throw new Error('relation does not exist')
    }
    const { app } = buildApp(ADMIN, () => failing())
    openApp = app
    const res = await app.inject({
      method: 'GET',
      url: `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=1&caseName=x`
    })
    expect(res.statusCode).toBe(500)
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  test('client abort mid-stream releases the row source', async () => {
    const wide = { chr: 'chr1', pos: 1, ref: 'A', alt: 'T', gene_symbol: 'X'.repeat(512) }
    const source = trackedRows([wide], { endless: true })
    const { app } = buildApp(ADMIN, () => source.iterable)
    openApp = app
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: `${VARIANT_EXPORT_DOWNLOAD_PATH}?caseId=1&caseName=x` },
        (res) => {
          expect(res.statusCode).toBe(200)
          res.once('data', () => {
            req.destroy()
            resolve()
          })
        }
      )
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET') reject(error)
      })
      req.end()
    })

    await vi.waitFor(() => expect(source.state.released).toBe(true), { timeout: 5000 })
    const yieldedAtRelease = source.state.yielded
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(source.state.yielded).toBe(yieldedAtRelease)
  })
})
