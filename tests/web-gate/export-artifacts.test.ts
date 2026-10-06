/**
 * Export artifact building blocks: the streaming ZIP/XLSX writers (bounded
 * memory, valid output) and the panel BED artifact delivered through a
 * download grant.
 */
import fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import AdmZip from 'adm-zip'
import { describe, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'

vi.mock('../../src/web/server/web-gene-reference', () => ({
  getWebGeneReferenceService: () => ({
    getCoordinatesForGenes: (ids: string[]) =>
      new Map(
        ids.map((id, i) => [
          id,
          { chromosome: '22', start_pos: 1000 * (i + 1), end_pos: 1000 * (i + 1) + 500 }
        ])
      )
  })
}))

import { zipStream } from '../../src/web/server/downloads/zip-stream'
import { MAX_XLSX_DATA_ROWS, xlsxStream } from '../../src/web/server/downloads/xlsx-stream'
import { DownloadGrantRegistry } from '../../src/web/server/downloads/download-grants'
import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { registerExportDownloadRoutes } from '../../src/web/server/routes/export-download'
import { makeDeps } from './helpers/dispatcher-adapters'

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const part of stream) parts.push(part)
  return Buffer.concat(parts)
}

describe('zipStream', () => {
  test('writes a standard archive whose CRCs and sizes verify', async () => {
    async function* big(): AsyncGenerator<string> {
      for (let i = 0; i < 2000; i += 1) yield `line ${i} ${'x'.repeat(100)}\n`
    }
    const zip = await collect(
      zipStream([
        { name: 'a.txt', content: big },
        {
          name: 'dir/ü.txt',
          content: async function* () {
            yield Buffer.from('hello')
          }
        }
      ])
    )
    const archive = new AdmZip(zip)
    const names = archive.getEntries().map((e) => e.entryName)
    expect(names).toEqual(['a.txt', 'dir/ü.txt'])
    expect(archive.readAsText('dir/ü.txt')).toBe('hello')
    const text = archive.readAsText('a.txt')
    expect(text.split('\n')).toHaveLength(2001)
    // adm-zip verifies the CRC when it inflates.
    expect(() => archive.getEntries().forEach((e) => e.getData())).not.toThrow()
  })
})

describe('xlsxStream', () => {
  test('pulls rows lazily: reading the first chunk does not drain the source', async () => {
    let produced = 0
    async function* rows(): AsyncGenerator<string[]> {
      for (;;) {
        produced += 1
        yield [`row-${produced}`, 'x'.repeat(200)]
      }
    }
    const result = { rowCount: 0, truncated: false }
    const stream = xlsxStream({ name: 'S', header: ['a', 'b'], rows: rows() }, result)
    let bytes = 0
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > 32 * 1024) break
    }
    // An endless source terminated after a bounded number of rows: memory is
    // bounded by the flush size, not by the export size.
    expect(produced).toBeGreaterThan(0)
    expect(produced).toBeLessThan(5000)
  })

  test('escapes XML, keeps numbers numeric and caps rows at the Excel limit', async () => {
    expect(MAX_XLSX_DATA_ROWS).toBe(1_048_575)
    async function* rows(): AsyncGenerator<(string | number | null)[]> {
      yield ['<b>&"x"</b>', 42.5, null]
      yield ['control\u0001char', -1, 'ok']
    }
    const result = { rowCount: 0, truncated: false }
    const buffer = await collect(
      xlsxStream({ name: 'Data', header: ['text', 'num', 'opt'], rows: rows() }, result, {
        name: 'Info',
        rows: (r) => [['Rows', r.rowCount]]
      })
    )
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const data = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Data, { header: 1 })
    expect(data).toEqual([
      ['text', 'num', 'opt'],
      ['<b>&"x"</b>', 42.5],
      ['controlchar', -1, 'ok']
    ])
    expect(result).toEqual({ rowCount: 2, truncated: false })
    const info = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Info, { header: 1 })
    expect(info).toEqual([['Rows', 2]])
  })
})

describe('DownloadGrantRegistry', () => {
  test('caps pending grants per user (oldest evicted)', () => {
    const grants = new DownloadGrantRegistry<string>({ maxPerUser: 2 })
    const user = { id: 1, username: 'u' }
    const first = grants.issue(user, 'a')
    grants.issue(user, 'b')
    grants.issue(user, 'c')
    expect(grants.size).toBe(2)
    expect(grants.redeem(first.token, 1)).toEqual({ ok: false, reason: 'unknown-or-used' })
  })

  test('rejects malformed tokens without throwing', () => {
    const grants = new DownloadGrantRegistry<string>()
    for (const token of ['', 'a', 'a.b', 'a.b.c', '../../etc.1.x']) {
      expect(grants.redeem(token, 1).ok).toBe(false)
    }
  })
})

describe('panel BED artifact', () => {
  test('streams the panel as BED through a download grant', async () => {
    const harness = makeDeps()
    harness.execute.mockImplementation(async (task: { type: string }) => {
      if (task.type === 'panels:get') return { id: 4, name: 'Cardio v2' }
      if (task.type === 'panels:getGenes') {
        return [
          { hgnc_id: 'HGNC:1', symbol: 'TTN' },
          { hgnc_id: 'HGNC:2', symbol: 'MYH7' }
        ]
      }
      return null
    })
    harness.deps.downloadGrants = new DownloadGrantRegistry()
    const app = fastify()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)
    app.addHook('preHandler', async (request) => {
      request.session = {
        user: { id: 3, username: 'ana', role: 'analyst', passwordChangedAt: null }
      } as never
    })
    registerExportDownloadRoutes(app, harness.deps)
    registerDispatcher(app, harness.deps, buildDispatcher(harness.deps).overrides)

    const prepared = await app.inject({
      method: 'POST',
      url: '/api/export/prepareDownload',
      payload: { args: [{ kind: 'panel-bed', panelId: 4, assembly: 'GRCh38', paddingBp: 10 }] }
    })
    expect(prepared.statusCode, prepared.body).toBe(200)
    const path = `/api/${(prepared.json() as { downloadPath: string }).downloadPath}`
    const res = await app.inject({ method: 'GET', url: path })

    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-disposition']).toContain('filename="Cardio_v2_GRCh38.bed"')
    expect(res.body.split('\n')).toEqual([
      'track name="Cardio v2" description="Gene panel: Cardio v2"',
      'chr22\t989\t1510\tTTN',
      'chr22\t1989\t2510\tMYH7',
      ''
    ])
    expect(harness.writeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        params: [expect.objectContaining({ entity_key: 'panels:exportBed', user_name: 'ana' })]
      })
    )
    await app.close()
  })
})
