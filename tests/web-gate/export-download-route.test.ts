import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'

import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'

import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { DownloadGrantRegistry } from '../../src/web/server/downloads/download-grants'
import { registerExportDownloadRoutes } from '../../src/web/server/routes/export-download'
import { makeDeps } from './helpers/dispatcher-adapters'

type Row = Record<string, unknown>

/** Sessions keyed by the `x-test-user` header (default: analyst #7). */
const USERS: Record<string, { id: number; username: string; role: string }> = {
  analyst: { id: 7, username: 'ana', role: 'analyst' },
  other: { id: 8, username: 'bob', role: 'analyst' },
  viewer: { id: 9, username: 'vic', role: 'viewer' }
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

function buildApp(
  rowsFor: (type: string) => AsyncIterable<Row> | unknown,
  options: { now?: () => number; mustChangePassword?: boolean } = {}
) {
  const harness = makeDeps()
  harness.execute.mockImplementation(async (task: { type: string }) => rowsFor(task.type))
  harness.deps.downloadGrants = new DownloadGrantRegistry({ now: options.now })
  const app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook('preHandler', async (request) => {
    const who = request.headers['x-test-user']
    if (who === 'anonymous') return
    const user = USERS[typeof who === 'string' ? who : 'analyst']
    request.session = {
      user: { ...user, passwordChangedAt: null },
      mustChangePassword: options.mustChangePassword === true
    } as never
  })
  registerExportDownloadRoutes(app, harness.deps)
  registerDispatcher(app, harness.deps, buildDispatcher(harness.deps).overrides)
  return { app, ...harness }
}

async function prepare(
  app: FastifyInstance,
  request: Record<string, unknown>,
  user = 'analyst'
): Promise<{ statusCode: number; path?: string; body: unknown }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/export/prepareDownload',
    headers: { 'x-test-user': user },
    payload: { args: [request] }
  })
  const body = res.json() as { downloadPath?: string }
  return {
    statusCode: res.statusCode,
    path: body.downloadPath === undefined ? undefined : `/api/${body.downloadPath}`,
    body
  }
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

const VARIANTS_REQUEST = {
  kind: 'variants',
  caseId: 3,
  caseName: 'Case A/1',
  filters: { consequences: ['HIGH'], gene_symbol: 'COMT' }
}

let openApp: FastifyInstance | undefined
afterEach(async () => {
  await openApp?.close()
  openApp = undefined
})

describe('web export: prepare + signed download', () => {
  test('streams the case variant CSV as an attachment with filters forwarded', async () => {
    const source = trackedRows(VARIANT_ROWS)
    const { app, execute, writeExecute, deps } = buildApp(() => source.iterable)
    openApp = app

    const prepared = await prepare(app, VARIANTS_REQUEST)
    expect(prepared.statusCode, JSON.stringify(prepared.body)).toBe(200)
    expect(prepared.path).toMatch(/^\/api\/download\/[\w-]+\.\d+\.[\w-]+$/)
    // Preparing touches no data.
    expect(execute).not.toHaveBeenCalled()

    const res = await app.inject({ method: 'GET', url: prepared.path! })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Case_A_1_variants.csv"; filename*=UTF-8''Case_A_1_variants.csv`
    )
    expect(res.headers['cache-control']).toBe('no-store')
    const lines = res.body.split('\r\n')
    expect(lines[0]).toBe(
      'Chromosome,Position,Reference,Alternate,Genotype,Gene,Consequence,Impact,Transcript,' +
        'cDNA,AA Change,gnomAD AF,CADD,Quality,ClinVar,HPO Similarity,MOI'
    )
    expect(lines[1]).toBe('chr22,100,A,G,,COMT,,,,,,1.23e-4,25.46,,,,')
    expect(lines[2]).toContain('"A,B ""quoted"""')
    expect(lines).toHaveLength(4)
    expect(execute).toHaveBeenCalledWith({
      type: 'export:variants',
      params: [{ consequences: ['HIGH'], gene_symbol: 'COMT', case_id: 3 }]
    })
    expect(writeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audit:append',
        params: [
          expect.objectContaining({
            action_type: 'api_read',
            entity_key: 'export:variants',
            user_name: 'ana'
          })
        ]
      })
    )
    expect(source.state.released).toBe(true)
    // Final export:progress event for the requesting user only.
    expect(deps.events.publish).toHaveBeenCalledWith(
      7,
      'export:progress',
      expect.objectContaining({ current: 2, done: true, fileName: 'Case_A_1_variants.csv' })
    )
  })

  test('streams the cohort CSV with validated params', async () => {
    const rows = [{ chr: 'chr1', pos: 5, gene_symbol: 'TP53', cohort_frequency: 0.5 }]
    const { app, execute } = buildApp(() => trackedRows(rows).iterable)
    openApp = app

    const params = { gene_symbol: 'TP53', limit: 25 }
    const prepared = await prepare(app, { kind: 'cohort', params })
    const res = await app.inject({ method: 'GET', url: prepared.path! })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="cohort_variants_\d{4}-\d{2}-\d{2}\.csv"/
    )
    expect(res.body.split('\r\n')[0]).toMatch(/^Chromosome,Position,Reference,Alternate,Gene,/)
    expect(res.body).toContain('chr1,5,,,TP53')
    expect(execute).toHaveBeenCalledWith({ type: 'export:cohort', params: [params] })
  })

  test('streams a valid XLSX workbook (data + info sheet)', async () => {
    const { app } = buildApp(() => trackedRows(VARIANT_ROWS).iterable)
    openApp = app
    const prepared = await prepare(app, { ...VARIANTS_REQUEST, format: 'xlsx' })
    const res = await app.inject({ method: 'GET', url: prepared.path! })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(res.headers['content-disposition']).toContain('Case_A_1_variants.xlsx')
    const workbook = XLSX.read(res.rawPayload, { type: 'buffer' })
    expect(workbook.SheetNames).toEqual(['Variants', 'Export Info'])
    const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Variants, { header: 1 })
    expect(data[0]).toContain('Chromosome')
    expect(data[1].slice(0, 4)).toEqual(['chr22', 100, 'A', 'G'])
    expect(data[2]).toContain('A,B "quoted"')
    const info = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Export Info'], { header: 1 })
    expect(info).toContainEqual(['Total Variants', 2])
    expect(info).toContainEqual(['Gene', 'COMT'])
  })

  test('a download link is single-use (replay is refused)', async () => {
    const { app } = buildApp(() => trackedRows(VARIANT_ROWS).iterable)
    openApp = app
    const prepared = await prepare(app, VARIANTS_REQUEST)
    expect((await app.inject({ method: 'GET', url: prepared.path! })).statusCode).toBe(200)
    const replay = await app.inject({ method: 'GET', url: prepared.path! })
    expect(replay.statusCode).toBe(404)
    expect(replay.json()).toMatchObject({ message: 'download-not-found' })
  })

  test('another user cannot redeem the link, and the attempt burns it', async () => {
    const { app, execute } = buildApp(() => trackedRows(VARIANT_ROWS).iterable)
    openApp = app
    const prepared = await prepare(app, VARIANTS_REQUEST)
    const stolen = await app.inject({
      method: 'GET',
      url: prepared.path!,
      headers: { 'x-test-user': 'other' }
    })
    expect(stolen.statusCode).toBe(403)
    expect(execute).not.toHaveBeenCalled()
    const owner = await app.inject({ method: 'GET', url: prepared.path! })
    expect(owner.statusCode).toBe(404)
  })

  test('an expired link is refused with 410', async () => {
    let now = 1_000_000
    const { app, execute } = buildApp(() => trackedRows(VARIANT_ROWS).iterable, {
      now: () => now
    })
    openApp = app
    const prepared = await prepare(app, VARIANTS_REQUEST)
    now += 61_000
    const res = await app.inject({ method: 'GET', url: prepared.path! })
    expect(res.statusCode).toBe(410)
    expect(execute).not.toHaveBeenCalled()
  })

  test('a tampered token is refused', async () => {
    const { app, execute } = buildApp(() => trackedRows(VARIANT_ROWS).iterable)
    openApp = app
    const prepared = await prepare(app, VARIANTS_REQUEST)
    const tampered = `${prepared.path!.slice(0, -2)}xx`
    const res = await app.inject({ method: 'GET', url: tampered })
    expect(res.statusCode).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })

  test('viewers can neither prepare nor redeem exports', async () => {
    const { app, execute } = buildApp(() => trackedRows(VARIANT_ROWS).iterable)
    openApp = app
    const viewerPrepare = await prepare(app, VARIANTS_REQUEST, 'viewer')
    expect(viewerPrepare.statusCode).toBe(403)
    const prepared = await prepare(app, VARIANTS_REQUEST)
    const res = await app.inject({
      method: 'GET',
      url: prepared.path!,
      headers: { 'x-test-user': 'viewer' }
    })
    expect(res.statusCode).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  test('anonymous and pre-rotation sessions are refused before touching storage', async () => {
    const { app, execute } = buildApp(() => trackedRows([]).iterable)
    openApp = app
    const prepared = await prepare(app, VARIANTS_REQUEST)
    const anon = await app.inject({
      method: 'GET',
      url: prepared.path!,
      headers: { 'x-test-user': 'anonymous' }
    })
    expect(anon.statusCode).toBe(401)
    await app.close()

    const rotating = buildApp(() => trackedRows([]).iterable, { mustChangePassword: true })
    openApp = rotating.app
    const res = await rotating.app.inject({ method: 'GET', url: '/api/download/a.1.b' })
    expect(res.statusCode).toBe(403)
    expect(execute).not.toHaveBeenCalled()
    expect(rotating.execute).not.toHaveBeenCalled()
  })

  test.each([
    ['missing case name', { kind: 'variants', caseId: 1, filters: {} }],
    ['non-numeric case id', { kind: 'variants', caseId: 'abc', caseName: 'x', filters: {} }],
    [
      'out-of-range filter',
      { kind: 'variants', caseId: 1, caseName: 'x', filters: { gnomad_af_max: 7 } }
    ],
    ['unknown format', { ...VARIANTS_REQUEST, format: 'pdf' }],
    ['invalid cohort params', { kind: 'cohort', params: { limit: -1 } }],
    ['unknown artifact kind', { kind: 'database-dump' }],
    ['invalid BED padding', { kind: 'panel-bed', panelId: 1, assembly: 'GRCh38', paddingBp: -5 }]
  ])('prepare returns 400 for %s', async (_label, request) => {
    const { app, execute } = buildApp(() => trackedRows([]).iterable)
    openApp = app
    const res = await prepare(app, request)
    expect(res.statusCode, JSON.stringify(res.body)).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  test('a query that fails before the first row returns a JSON 500, not a truncated file', async () => {
    async function* failing(): AsyncGenerator<Row> {
      yield* []
      throw new Error('relation does not exist')
    }
    const { app } = buildApp(() => failing())
    openApp = app
    const prepared = await prepare(app, VARIANTS_REQUEST)
    const res = await app.inject({ method: 'GET', url: prepared.path! })
    expect(res.statusCode).toBe(500)
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  test.each([['csv'], ['xlsx']])(
    'client abort mid-stream releases the row source (%s)',
    async (format) => {
      const wide = { chr: 'chr1', pos: 1, ref: 'A', alt: 'T', gene_symbol: 'X'.repeat(512) }
      const source = trackedRows([wide], { endless: true })
      const { app } = buildApp(() => source.iterable)
      openApp = app
      const prepared = await prepare(app, { ...VARIANTS_REQUEST, format })
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as AddressInfo

      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path: prepared.path!, headers: { 'x-test-user': 'analyst' } },
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
    }
  )
})
