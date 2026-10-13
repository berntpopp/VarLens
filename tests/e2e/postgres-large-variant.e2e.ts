/**
 * E2E test: PostgreSQL large-allele import + coord_hash round-trip.
 *
 * Imports the synthetic 9.7 KB ALT allele fixture into a PostgreSQL backend
 * and verifies that:
 *   (1) the variant row is stored with a 32-byte coord_hash, and
 *   (2) the coord_hash matches the JS reference encoding byte-for-byte.
 *
 * Requires:
 *   VARLENS_RUN_POSTGRES_E2E=1
 *   Docker container: postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev
 */
import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { resolve } from 'node:path'

import { hashCoord } from '../main/storage/coord-hash-encoding'
import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

test('postgres dev mode imports a 9.7 KB allele and stores its coord_hash', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  const pgUrl =
    process.env.VARLENS_PG_URL ??
    'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
  const pgSchema = process.env.VARLENS_PG_SCHEMA ?? 'public'

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: pgUrl,
        VARLENS_PG_SCHEMA: pgSchema
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const fixturePath = resolve(process.cwd(), 'tests/test-data/vcf/synthetic-large-allele.vcf')
    const caseName = `Large Allele PG ${Date.now()}`

    const importResult = await launched.window.evaluate(
      async ({ fixturePath, caseName }) => {
        return await window.api.import.start(fixturePath, caseName, {
          selectedSample: 'HG002',
          genomeBuild: 'GRCh38'
        })
      },
      { fixturePath, caseName }
    )

    expect(importResult).not.toEqual(
      expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
        userMessage: expect.any(String)
      })
    )

    const { caseId, variantCount } = importResult as { caseId: number; variantCount: number }
    expect(caseId).toBeGreaterThan(0)
    expect(variantCount).toBe(2) // one normal SNV + one 9.7 KB allele

    // Verify directly against the database that:
    //   (1) the row exists,
    //   (2) ref/alt lengths match the fixture,
    //   (3) coord_hash is 32 bytes and matches the JS reference encoding.
    const client = new Client({ connectionString: pgUrl })
    await client.connect()
    try {
      const result = await client.query<{
        chr: string
        pos: string
        ref_len: number
        alt_len: number
        coord_hash: Buffer
      }>(
        `SELECT chr, pos::text AS pos, octet_length(ref) AS ref_len, octet_length(alt) AS alt_len, coord_hash
         FROM ${pgSchema}.variants
         WHERE case_id = $1 AND pos = 31311231`,
        [caseId]
      )
      expect(result.rows).toHaveLength(1)
      const row = result.rows[0]
      expect(row.ref_len).toBe(1)
      expect(row.alt_len).toBe(9705)
      expect(row.coord_hash.length).toBe(32)

      // Reconstruct what the hash should be from JS, byte-for-byte.
      const bigAlt = 'A'.repeat(9705)
      const expected = hashCoord('chr6', 31311231, 'A', bigAlt)
      expect(row.coord_hash.equals(expected)).toBe(true)

      // Also verify the normal SNV row's coord_hash to catch regressions on
      // the short-allele path. Without this, a regression that only handles
      // long alleles correctly would still pass `variantCount === 2`.
      const snv = await client.query<{ coord_hash: Buffer }>(
        `SELECT coord_hash
         FROM ${pgSchema}.variants
         WHERE case_id = $1 AND pos = 31000000`,
        [caseId]
      )
      expect(snv.rows).toHaveLength(1)
      expect(snv.rows[0].coord_hash.equals(hashCoord('chr6', 31000000, 'G', 'A'))).toBe(true)
    } finally {
      await client.end()
    }
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
