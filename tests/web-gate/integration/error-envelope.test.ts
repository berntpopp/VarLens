import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import { SAME_ORIGIN_HEADERS, startWebDriver, type WebDriver } from '../helpers/web-driver'

/**
 * Error envelope against real Postgres (PR-W4, P-10): name clashes on
 * presets, region files and a duplicate import case name are 409 CONFLICT
 * with a readable message — they used to be 500 "An unexpected error
 * occurred".
 */
const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''
const isWebBuilt = existsSync(resolve(process.cwd(), 'out/web/server.cjs'))

interface Res {
  statusCode: number
  body: string
  json: () => unknown
}

function firstRecordsVcf(): string {
  const lines = readFileSync(
    resolve(process.cwd(), 'tests/test-data/vcf/synthetic-unit-test.vcf'),
    'utf8'
  ).split('\n')
  const meta = lines.filter((line) => line.startsWith('##'))
  const header = lines
    .find((line) => line.startsWith('#CHROM'))!
    .split('\t')
    .slice(0, 10)
  const body = lines
    .filter((line) => line !== '' && !line.startsWith('#'))
    .slice(0, 3)
    .map((line) => line.split('\t').slice(0, 10).join('\t'))
  return [...meta, header.join('\t'), ...body, ''].join('\n')
}

async function uploadVcf(driver: WebDriver, name: string): Promise<string> {
  const upload = (await driver.app.inject({
    method: 'POST',
    url: '/api/import/upload',
    headers: {
      ...SAME_ORIGIN_HEADERS,
      cookie: driver.cookie,
      'content-type': 'application/octet-stream',
      'x-varlens-file-name': `${name}.vcf`
    },
    payload: Buffer.from(firstRecordsVcf())
  })) as unknown as Res
  expect(upload.statusCode, upload.body).toBe(200)
  return (upload.json() as { ref: string }).ref
}

function expectConflict(res: Res, pattern: RegExp): void {
  expect(res.statusCode, res.body).toBe(409)
  const body = res.json() as { code: string; userMessage: string }
  expect(body.code).toBe('CONFLICT')
  expect(body.userMessage).toMatch(pattern)
  expect(res.body).not.toContain('INSERT')
}

describe.skipIf(!HAS_PG)('error envelope: name clashes are 409 CONFLICT (web/Postgres)', () => {
  test('duplicate filter preset name', async () => {
    const driver = await startWebDriver()
    try {
      const preset = { name: 'Parity preset', description: null, filterJson: {} }
      expect((await driver.api('presets', 'create', preset)).statusCode).toBe(200)
      expectConflict(
        (await driver.api('presets', 'create', preset)) as Res,
        /'Parity preset' already exists/
      )
    } finally {
      await driver.close()
    }
  }, 60_000)

  test('duplicate region file name', async () => {
    const driver = await startWebDriver()
    try {
      expect((await driver.api('regionFiles', 'create', 'Exome', null)).statusCode).toBe(200)
      expectConflict(
        (await driver.api('regionFiles', 'create', 'Exome', null)) as Res,
        /region file with this name \('Exome'\) already exists/
      )
    } finally {
      await driver.close()
    }
  }, 60_000)

  test.skipIf(!isWebBuilt)(
    'duplicate import case name',
    async () => {
      const uploadDir = mkdtempSync(join(tmpdir(), 'varlens-conflict-gate-'))
      const previous = process.env.VARLENS_WEB_UPLOAD_DIR
      process.env.VARLENS_WEB_UPLOAD_DIR = uploadDir
      const driver = await startWebDriver()
      try {
        const first = await driver.api('import', 'start', await uploadVcf(driver, 'a'), 'HG005', {
          genomeBuild: 'hg38'
        })
        expect(first.statusCode, first.body).toBe(200)
        const again = await driver.api('import', 'start', await uploadVcf(driver, 'b'), 'HG005', {
          genomeBuild: 'hg38'
        })
        expectConflict(again as Res, /HG005/)
      } finally {
        await driver.close()
        rmSync(uploadDir, { recursive: true, force: true })
        if (previous === undefined) delete process.env.VARLENS_WEB_UPLOAD_DIR
        else process.env.VARLENS_WEB_UPLOAD_DIR = previous
      }
    },
    90_000
  )
})
