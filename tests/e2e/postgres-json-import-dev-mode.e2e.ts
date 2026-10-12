import { expect, test } from '@playwright/test'
import { join } from 'node:path'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

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

test('postgres dev mode imports a JSON file and reads the created dataset', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL:
          process.env.VARLENS_PG_URL ??
          'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const fixturePath = join(process.cwd(), 'tests/fixtures/import/simple-format.json')
    const caseName = `PG JSON Import ${Date.now()}`

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
          cases: await window.api.cases.query({ limit: 25, offset: 0, search_term: caseName }),
          dataInfo: await window.api.caseMetadata.getDataInfo(unwrappedImport.caseId),
          typeCounts: await window.api.variants.typeCounts(unwrappedImport.caseId),
          brca1: await window.api.variants.query(
            unwrappedImport.caseId,
            { gene_symbol: 'BRCA1' },
            0,
            25
          ),
          fullText: await window.api.variants.query(
            unwrappedImport.caseId,
            { search_query: 'BRCA1' },
            0,
            25
          ),
          internalAf: await window.api.variants.query(
            unwrappedImport.caseId,
            { max_internal_af: 1 },
            0,
            25
          )
        }
      },
      { fixturePath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect(importResult.caseId).toBeGreaterThan(3)
    expect(importResult.variantCount).toBe(3)

    expect(expectSuccessfulIpcResult(results.cases)).toMatchObject({
      total_count: 1,
      data: [
        expect.objectContaining({
          id: importResult.caseId,
          name: caseName,
          variant_count: 3,
          genome_build: 'GRCh38'
        })
      ]
    })

    expect(expectSuccessfulIpcResult(results.dataInfo)).toMatchObject({
      case_id: importResult.caseId,
      import_file_name: 'simple-format.json',
      import_file_type: 'simple'
    })

    expect(expectSuccessfulIpcResult(results.typeCounts)).toMatchObject({ snv: 3 })
    expect(expectSuccessfulIpcResult(results.brca1)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', consequence: 'HIGH' })]
    })
    expect(expectSuccessfulIpcResult(results.fullText)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1' })]
    })
    expect(expectSuccessfulIpcResult(results.internalAf)).toMatchObject({ total_count: 3 })
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
