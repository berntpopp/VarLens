import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import {
  exportPostgresCohort,
  exportPostgresVariants
} from '../../../src/main/ipc/handlers/export-logic'

describe('postgres export logic', () => {
  it('returns an export error when the CSV stream cannot be opened', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-pg-export-'))
    await rm(tempDir, { recursive: true, force: true })

    await expect(
      Promise.race([
        exportPostgresVariants(
          (async function* () {
            yield { id: 1, chr: '1' }
          })(),
          join(tempDir, 'missing', 'variants.csv'),
          {}
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('export did not settle')), 1000)
        )
      ])
    ).rejects.toThrow(/ENOENT/)
  })

  it('streams postgres cohort rows to CSV with cohort export columns', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-pg-cohort-export-'))
    const outputFilePath = join(tempDir, 'cohort.csv')

    try {
      const result = await exportPostgresCohort(
        (async function* () {
          yield {
            chr: '1',
            pos: 101,
            ref: 'A',
            alt: 'G',
            gene_symbol: 'BRCA1',
            carrier_count: 2,
            total_cases: 4,
            cohort_frequency: 0.5
          }
        })(),
        outputFilePath,
        {}
      )

      expect(result).toEqual({ success: true, filePath: outputFilePath })

      const { readFile } = await import('node:fs/promises')
      const csv = await readFile(outputFilePath, 'utf8')

      expect(csv).toContain('Chromosome,Position,Reference,Alternate,Gene')
      expect(csv).toContain('1,101,A,G,BRCA1')
      expect(csv).toContain('2,4,0.5')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
