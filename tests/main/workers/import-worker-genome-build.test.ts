// @vitest-environment node
/**
 * Batch import (files, folder, zip, every JSON import) stores each case under
 * the build its file declares, else the batch's "build for files without one",
 * and never under a silent GRCh38 default (#557).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { runImportSession } from '../../../src/main/workers/import-worker'
import { BUILD_COPY, GENOME_BUILDS } from '../../../src/shared/config/genome-builds.config'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'

type StartMessage = Extract<MainMessage, { type: 'start' }>
type FileRequest = StartMessage['files'][number]

const GRCH37 = GENOME_BUILDS.find((b) => b.id === 'GRCh37')!

describe('import worker genome build (#557)', () => {
  let dir: string
  let dbPath: string
  let db: DatabaseType

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-worker-build-'))
    dbPath = join(dir, 'test.db')
    db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
    writeFileSync(
      join(dir, 'grch37.vcf'),
      [
        '##fileformat=VCFv4.2',
        `##contig=<ID=1,length=${GRCH37.contigs[1]}>`,
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1',
        '1\t100\t.\tA\tG\t50\tPASS\t.\tGT\t0/1',
        ''
      ].join('\n')
    )
    writeFileSync(
      join(dir, 'case.json'),
      JSON.stringify({
        variants: [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G', gene_symbol: 'G', gt_num: '0/1' }]
      })
    )
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function run(files: Array<Partial<FileRequest>>): Promise<WorkerMessage[]> {
    const messages: WorkerMessage[] = []
    await runImportSession(
      {
        type: 'start',
        dbPath,
        files: files.map((f) => ({ isDuplicate: false, duplicateStrategy: 'skip', ...f }))
      } as StartMessage,
      { postMessage: (message) => messages.push(message) },
      () => false
    )
    return messages
  }

  const buildOf = (name: string): string | undefined =>
    (
      db.prepare('SELECT genome_build FROM cases WHERE name = ?').get(name) as
        { genome_build: string } | undefined
    )?.genome_build

  it('keeps a declared GRCh37 VCF as GRCh37 and gives JSON the fallback', async () => {
    await run([
      { filePath: join(dir, 'grch37.vcf'), caseName: 'vcf37', fallbackGenomeBuild: 'GRCh38' },
      { filePath: join(dir, 'case.json'), caseName: 'json', fallbackGenomeBuild: 'GRCh38' }
    ])
    expect(buildOf('vcf37')).toBe('GRCh37')
    expect(buildOf('json')).toBe('GRCh38')
  })

  it('fails a file without any build instead of defaulting to GRCh38', async () => {
    const messages = await run([{ filePath: join(dir, 'case.json'), caseName: 'json' }])
    const done = messages.find((m) => m.type === 'complete')
    expect(done?.type === 'complete' && done.results.details[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining(BUILD_COPY.missingBuild)
    })
    expect(buildOf('json')).toBeUndefined()
  })
})
