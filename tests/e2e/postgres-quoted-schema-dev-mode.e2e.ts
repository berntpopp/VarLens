import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { Pool } from 'pg'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

const DEFAULT_PG_URL = 'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const QUOTED_SCHEMA = 'Case Lab'

function expectSuccessfulIpcResult<T>(result: T): T {
  expect(result).not.toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      userMessage: expect.any(String)
    })
  )
  return result
}

test('postgres dev mode migrates and queries variants from a quoted non-public schema', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined
  const pgUrl = process.env.VARLENS_PG_URL ?? DEFAULT_PG_URL

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: pgUrl,
        VARLENS_PG_SCHEMA: QUOTED_SCHEMA
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const fixturePath = join(process.cwd(), 'tests/fixtures/import/simple-format.json')
    const caseName = `PG Quoted Schema ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ fixturePath, caseName }) => {
        const importResult = await window.api.import.start(fixturePath, caseName, {
          genomeBuild: 'GRCh38'
        })
        const unwrappedImport =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? { caseId: 0, variantCount: 0 }
            : importResult

        return {
          importResult,
          cases: await window.api.cases.query({ limit: 10, offset: 0, search_term: caseName }),
          variants: await window.api.variants.query(
            unwrappedImport.caseId,
            { gene_symbol: 'BRCA1' },
            0,
            10
          )
        }
      },
      { fixturePath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect(importResult.variantCount).toBe(3)

    expect(expectSuccessfulIpcResult(results.cases)).toMatchObject({
      total_count: 1,
      data: [
        expect.objectContaining({
          id: importResult.caseId,
          name: caseName,
          genome_build: 'GRCh38'
        })
      ]
    })

    expect(expectSuccessfulIpcResult(results.variants)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', consequence: 'HIGH' })]
    })

    await expectImportedCaseInQuotedSchema(pgUrl, caseName)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})

async function expectImportedCaseInQuotedSchema(pgUrl: string, caseName: string): Promise<void> {
  const pool = new Pool({ connectionString: pgUrl, max: 1 })

  try {
    const quotedSchema = await pool.query<{ case_count: string; variant_count: string }>(
      `
        SELECT
          COUNT(DISTINCT c.id)::text AS case_count,
          COUNT(v.id)::text AS variant_count
        FROM "Case Lab"."cases" c
        LEFT JOIN "Case Lab"."variants" v ON v.case_id = c.id
        WHERE c.name = $1
      `,
      [caseName]
    )
    const publicSchema = await pool.query<{ case_count: string }>(
      'SELECT COUNT(*)::text AS case_count FROM public.cases WHERE name = $1',
      [caseName]
    )

    expect(quotedSchema.rows[0]).toEqual({
      case_count: '1',
      variant_count: '3'
    })
    expect(publicSchema.rows[0]).toEqual({ case_count: '0' })
  } finally {
    await pool.end()
  }
}
