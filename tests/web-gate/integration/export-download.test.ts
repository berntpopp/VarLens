import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { request as httpRequest } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'

import { SAME_ORIGIN_HEADERS, startWebDriver, type WebDriver } from '../helpers/web-driver'

/**
 * Web-mode export downloads against a live buildApp + real PostgreSQL.
 *
 * Seeds one case through the real upload → import path, then exercises
 * POST /api/export/prepareDownload + GET /api/download/:token: status,
 * attachment headers, CSV / XLSX rows that match the filtered query, auth
 * (401), validation (400), single use, the api_read audit row, and that a
 * client abort mid-stream hands the pooled connection back (no lingering
 * non-idle backend).
 *
 * Gated on the web build + Postgres availability.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''

const APP_NAME = `varlens-export-gate-${process.pid}`
/** Enough rows that a paused client forces back-pressure on the cursor. */
const BULK_ROWS = 40_000

interface InjectResult {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
  json: () => unknown
}

/** Single-sample VCF built from the synthetic fixture's first three records. */
function buildVcf(rowCount: number): string {
  const source = readFileSync(
    resolve(process.cwd(), 'tests/test-data/vcf/synthetic-unit-test.vcf'),
    'utf8'
  ).split('\n')
  const meta = source.filter((line) => line.startsWith('##'))
  const header = source
    .find((line) => line.startsWith('#CHROM'))!
    .split('\t')
    .slice(0, 10)
  const templates = source
    .filter((line) => line !== '' && !line.startsWith('#'))
    .slice(0, 3)
    .map((line) => line.split('\t').slice(0, 10))
  const body: string[] = []
  for (let i = 0; i < rowCount; i += 1) {
    const fields = [...templates[i % templates.length]]
    fields[1] = String(20_000_000 + i * 10)
    fields[2] = '.'
    body.push(fields.join('\t'))
  }
  return [...meta, header.join('\t'), ...body, ''].join('\n')
}

async function importCase(driver: WebDriver, caseName: string, rows: number): Promise<number> {
  const upload = (await driver.app.inject({
    method: 'POST',
    url: '/api/import/upload',
    headers: {
      ...SAME_ORIGIN_HEADERS,
      cookie: driver.cookie,
      'content-type': 'application/octet-stream',
      'x-varlens-file-name': `${caseName}.vcf`
    },
    payload: Buffer.from(buildVcf(rows))
  })) as unknown as InjectResult
  expect(upload.statusCode, upload.body).toBe(200)
  const { ref } = upload.json() as { ref: string }
  const imported = await driver.api('import', 'start', ref, caseName, { genomeBuild: 'hg38' })
  expect(imported.statusCode, imported.body).toBe(200)
  const result = imported.json() as { caseId: number; variantCount: number }
  expect(result.variantCount).toBe(rows)
  return result.caseId
}

function csvRows(body: string): string[] {
  return body.split('\r\n').filter((line) => line !== '')
}

describe.skipIf(!isWebBuilt || !HAS_PG)('web export downloads (PostgreSQL)', () => {
  let driver: WebDriver
  let caseId: number
  let uploadDir: string
  const previousUploadDir = process.env.VARLENS_WEB_UPLOAD_DIR
  const previousAppName = process.env.VARLENS_PG_APPLICATION_NAME

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'varlens-export-gate-'))
    process.env.VARLENS_WEB_UPLOAD_DIR = uploadDir
    process.env.VARLENS_PG_APPLICATION_NAME = APP_NAME
    driver = await startWebDriver()
    caseId = await importCase(driver, 'export-gate-case', 30)
  }, 60_000)

  afterAll(async () => {
    await driver?.close()
    rmSync(uploadDir, { recursive: true, force: true })
    if (previousUploadDir === undefined) delete process.env.VARLENS_WEB_UPLOAD_DIR
    else process.env.VARLENS_WEB_UPLOAD_DIR = previousUploadDir
    if (previousAppName === undefined) delete process.env.VARLENS_PG_APPLICATION_NAME
    else process.env.VARLENS_PG_APPLICATION_NAME = previousAppName
  })

  function get(url: string, cookie: string | null = driver.cookie): Promise<InjectResult> {
    return driver.app.inject({
      method: 'GET',
      url,
      headers: cookie === null ? SAME_ORIGIN_HEADERS : { ...SAME_ORIGIN_HEADERS, cookie }
    }) as unknown as Promise<InjectResult>
  }

  async function prepare(request: Record<string, unknown>): Promise<string> {
    const res = await driver.api('export', 'prepareDownload', request)
    expect(res.statusCode, res.body).toBe(200)
    return `/api/${(res.json() as { downloadPath: string }).downloadPath}`
  }

  async function download(request: Record<string, unknown>): Promise<InjectResult> {
    return get(await prepare(request))
  }

  test('variant export streams the filtered rows as a CSV attachment', async () => {
    const filters = { consequences: ['HIGH'] }
    const expected = await driver.api('variants', 'query', caseId, filters, 0, 1000)
    expect(expected.statusCode, expected.body).toBe(200)
    const expectedTotal = (expected.json() as { data: unknown[] }).data.length
    expect(expectedTotal).toBeGreaterThan(0)
    expect(expectedTotal).toBeLessThan(30)

    const res = await download({
      kind: 'variants',
      caseId,
      caseName: 'Export Gate/Case',
      filters
    })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toContain(
      'attachment; filename="Export_Gate_Case_variants.csv"'
    )
    const [header, ...rows] = csvRows(res.body)
    expect(header.split(',').slice(0, 4)).toEqual([
      'Chromosome',
      'Position',
      'Reference',
      'Alternate'
    ])
    expect(rows).toHaveLength(expectedTotal)
    const impactIndex = header.split(',').indexOf('Impact')
    for (const row of rows) expect(row.split(',')[impactIndex]).toBe('HIGH')

    const unfiltered = await download({ kind: 'variants', caseId, caseName: 'x', filters: {} })
    expect(csvRows(unfiltered.body)).toHaveLength(31)
  })

  test('variant export streams a valid XLSX workbook', async () => {
    const path = await prepare({
      kind: 'variants',
      format: 'xlsx',
      caseId,
      caseName: 'x',
      filters: {}
    })
    const res = (await driver.app.inject({
      method: 'GET',
      url: path,
      headers: { ...SAME_ORIGIN_HEADERS, cookie: driver.cookie }
    })) as unknown as InjectResult & { rawPayload: Buffer }
    expect(res.statusCode).toBe(200)
    const workbook = XLSX.read(res.rawPayload, { type: 'buffer' })
    expect(workbook.SheetNames).toEqual(['Variants', 'Export Info'])
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Variants, { header: 1 })
    expect(rows).toHaveLength(31)
    // A download link works once.
    expect((await get(path)).statusCode).toBe(404)
  })

  test('cohort export streams the cohort rows as a CSV attachment', async () => {
    const params = { gene_symbol: 'COMT' }
    const res = await download({ kind: 'cohort', params })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="cohort_variants_/)
    const [header, ...rows] = csvRows(res.body)
    expect(header).toMatch(/^Chromosome,Position,Reference,Alternate,Gene,/)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.split(',')[4]).toBe('COMT')
  })

  test('exports are audited as api_read events', async () => {
    const pool = new Pool({ connectionString: PG_URL, max: 1 })
    try {
      const readAudit = () =>
        pool.query<{ entity_key: string; user_name: string }>(
          `SELECT entity_key, user_name FROM varlens_audit.audit_log
            WHERE project_schema = $1 AND action_type = 'api_read'
              AND entity_key IN ('export:variants', 'export:cohort')`,
          [driver.schema]
        )
      // Read audits are batched (audit-buffer.ts flushes every 250 ms), so
      // poll briefly instead of expecting the rows synchronously.
      let audit = await readAudit()
      const seenBoth = (): boolean => new Set(audit.rows.map((row) => row.entity_key)).size === 2
      for (let i = 0; i < 30 && !seenBoth(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        audit = await readAudit()
      }
      const keys = new Set(audit.rows.map((row) => row.entity_key))
      expect(keys).toEqual(new Set(['export:variants', 'export:cohort']))
      expect(audit.rows.every((row) => row.user_name === 'web-gate-admin')).toBe(true)
    } finally {
      await pool.end()
    }
  })

  test('unauthenticated requests get 401 and invalid params get 400', async () => {
    const path = await prepare({ kind: 'variants', caseId, caseName: 'x', filters: {} })
    const anon = await get(path, null)
    expect(anon.statusCode).toBe(401)
    expect(anon.headers['content-disposition']).toBeUndefined()

    const invalid = [
      { kind: 'variants', caseId: 0, caseName: 'x', filters: {} },
      { kind: 'variants', caseId, filters: {} },
      { kind: 'variants', caseId, caseName: 'x', filters: { gnomad_af_max: 7 } },
      { kind: 'cohort', params: { limit: 0 } }
    ]
    for (const request of invalid) {
      const res = await driver.api('export', 'prepareDownload', request)
      expect(res.statusCode, JSON.stringify(request)).toBe(400)
    }
  })

  test('a client abort mid-stream releases the pooled connection', async () => {
    const bulkCaseId = await importCase(driver, 'export-gate-bulk', BULK_ROWS)
    await driver.app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = driver.app.server.address() as AddressInfo
    const monitor = new Pool({ connectionString: PG_URL, max: 1 })
    const busyAppConnections = async (): Promise<number> => {
      const result = await monitor.query<{ busy: number }>(
        `SELECT count(*)::int AS busy FROM pg_stat_activity
          WHERE application_name = $1 AND state <> 'idle'`,
        [APP_NAME]
      )
      return result.rows[0].busy
    }

    const bulkPath = await prepare({
      kind: 'variants',
      caseId: bulkCaseId,
      caseName: 'bulk',
      filters: {}
    })
    try {
      await new Promise<void>((resolveAbort, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: bulkPath,
            headers: { ...SAME_ORIGIN_HEADERS, cookie: driver.cookie }
          },
          (res) => {
            expect(res.statusCode).toBe(200)
            // Stop reading: back-pressure keeps the server-side cursor open.
            res.pause()
            void (async () => {
              await vi.waitFor(async () => expect(await busyAppConnections()).toBe(1), {
                timeout: 5000
              })
              req.destroy()
              resolveAbort()
            })().catch(reject)
          }
        )
        req.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ECONNRESET') reject(error)
        })
        req.end()
      })

      await vi.waitFor(async () => expect(await busyAppConnections()).toBe(0), { timeout: 10_000 })

      // The pool is healthy afterwards: a full export still completes.
      const after = await download({ kind: 'variants', caseId, caseName: 'x', filters: {} })
      expect(after.statusCode).toBe(200)
      expect(csvRows(after.body)).toHaveLength(31)
    } finally {
      await monitor.end()
    }
  }, 120_000)
})
