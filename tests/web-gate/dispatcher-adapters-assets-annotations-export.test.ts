import { describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import { DecompressedSizeExceededError } from '../../src/main/import/stream-utils'
import { InvalidBedRowError } from '../../src/main/import/vcf/bed-reader'
import { stageExistingFileUpload } from '../../src/web/server/routes/upload-staging'
import { makeDeps } from './helpers/dispatcher-adapters'

describe('web dispatcher adapters: annotations, assets, and exports', () => {
  test('annotations.upsertGlobal delegates annotation and audit to one storage task', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['annotations:upsertGlobal'].handle(
      [
        'chr22',
        12345,
        'A',
        'T',
        {
          acmg_classification: 'VUS',
          starred: true,
          user_name: 'admin'
        }
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      task: {
        type: 'annotations:upsertGlobalWithAudit',
        params: [
          { chr: 'chr22', pos: 12345, ref: 'A', alt: 'T' },
          { acmg_classification: 'Uncertain significance', starred: true, user_name: 'admin' }
        ]
      }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('annotations.upsertGlobal rejects non-canonical ACMG casing like desktop IPC', async () => {
    const { deps, execute, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['annotations:upsertGlobal'].handle(
      [
        'chr22',
        12345,
        'A',
        'T',
        {
          acmg_classification: 'PATHOGENIC'
        }
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'invalid-annotation-upsert' })
    expect(execute).not.toHaveBeenCalled()
    expect(writeExecute).not.toHaveBeenCalled()
  })

  test('annotations.upsertPerCase normalizes ACMG shorthand before audited storage write', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['annotations:upsertPerCase'].handle(
      [3, 9, { acmg_classification: 'LP', user_name: 'reviewer' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(result).toEqual({
      task: {
        type: 'annotations:upsertPerCaseWithAudit',
        params: [3, 9, { acmg_classification: 'Likely pathogenic', user_name: 'reviewer' }]
      }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('annotations.upsertPerCase publishes annotation refresh events for the active web user', async () => {
    const { deps, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['annotations:upsertPerCase'].handle(
      [3, 9, { starred: true, user_name: 'reviewer' }],
      { session: { user: { id: 7 } } } as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(deps.events.publish).toHaveBeenCalledWith(7, 'variants:annotationChanged', {
      caseId: 3,
      variantId: 9,
      kind: 'star'
    })
  })

  test('case-metadata.createCohort maps renderer args to the storage task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['case-metadata:createCohort'].handle(
      ['Rare Cases', 12],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'case-metadata:createCohort',
      params: [{ name: 'Rare Cases', description: null }]
    })
  })

  test('analysis-groups.create preserves validated group fields', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['analysis-groups:create'].handle(
      [{ name: 'Trio A', groupType: 'family', description: 'family review' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'analysis-groups:create',
      params: ['Trio A', 'family', 'family review']
    })
  })

  test('analysis-groups.create rejects invalid group types before storage execution', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['analysis-groups:create'].handle(
      [{ name: 'Trio A', groupType: 'unsupported', description: 'family review' }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(400)
    expect(result).toEqual({ error: 'invalid-analysis-group-name' })
    expect(writeExecute).not.toHaveBeenCalled()
  })

  test('analysis-groups.addMember maps member args to the storage task shape', async () => {
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    await overrides['analysis-groups:addMember'].handle(
      [
        {
          groupId: 2,
          caseId: 7,
          role: 'proband',
          affectedStatus: 'affected',
          individualId: 'P1'
        }
      ],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'analysis-groups:addMember',
      params: [2, 7, 'proband', 'affected', 'P1']
    })
  })

  test('region-files.importBed delegates the staged BED path to strict storage streaming', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    process.env.NODE_ENV = 'production'
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const dir = await mkdtemp(join(tmpdir(), 'varlens-bed-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir

    try {
      const filePath = join(dir, 'regions.bed')
      await writeFile(filePath, 'chr1\t0\t10\tRegionA\n# ignored\nchr2\t5\t9\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'regions.bed',
        sourcePath: filePath
      })
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['region-files:importBed'].handle(
        [4, upload.ref],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).not.toHaveBeenCalled()
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'region-files:importBed',
        params: [4, upload.storedPath, { rejectMalformedRows: true }]
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
    }
  })

  test('region-files.importBed delegates a staged gzip BED to storage streaming', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    process.env.NODE_ENV = 'production'
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const dir = await mkdtemp(join(tmpdir(), 'varlens-bed-gzip-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir

    try {
      const filePath = join(dir, 'regions.bed.gz')
      await writeFile(filePath, gzipSync(Buffer.from('chr1\t0\t10\tRegionA\nchr2\t5\t9\n')))
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'regions.bed.gz',
        sourcePath: filePath
      })
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      await overrides['region-files:importBed'].handle(
        [4, upload.ref],
        request as never,
        reply as never,
        deps
      )

      expect(writeExecute).toHaveBeenCalledWith({
        type: 'region-files:importBed',
        params: [4, upload.storedPath, { rejectMalformedRows: true }]
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
    }
  })

  test('region-files.importBed propagates strict malformed-row rejection from storage', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    process.env.NODE_ENV = 'production'
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const dir = await mkdtemp(join(tmpdir(), 'varlens-bed-malformed-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir

    try {
      const filePath = join(dir, 'regions.bed')
      await writeFile(filePath, 'chr1\tbad\t10\n')
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'regions.bed',
        sourcePath: filePath
      })
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }
      writeExecute.mockRejectedValueOnce(new InvalidBedRowError('chr1\tbad\t10'))

      await expect(
        overrides['region-files:importBed'].handle(
          [4, upload.ref],
          request as never,
          reply as never,
          deps
        )
      ).rejects.toThrow(InvalidBedRowError)
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'region-files:importBed',
        params: [4, upload.storedPath, { rejectMalformedRows: true }]
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
    }
  })

  test('region-files.importBed propagates the storage decompressed-byte cap', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    const prevMaxBytes = process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES = '100'
    const { deps, writeExecute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)
    const dir = await mkdtemp(join(tmpdir(), 'varlens-bed-cap-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir

    try {
      const filePath = join(dir, 'regions.bed.gz')
      await writeFile(filePath, gzipSync(Buffer.from('chr1\t0\t10\n'.repeat(1_000))))
      const upload = await stageExistingFileUpload({
        userId: 7,
        originalName: 'regions.bed.gz',
        sourcePath: filePath
      })
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }
      writeExecute.mockRejectedValueOnce(new DecompressedSizeExceededError(100))

      await expect(
        overrides['region-files:importBed'].handle(
          [4, upload.ref],
          request as never,
          reply as never,
          deps
        )
      ).rejects.toThrow(DecompressedSizeExceededError)
      expect(writeExecute).toHaveBeenCalledWith({
        type: 'region-files:importBed',
        params: [4, upload.storedPath, { rejectMalformedRows: true }]
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
      else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
      if (prevMaxBytes === undefined) delete process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES
      else process.env.VARLENS_IMPORT_MAX_DECOMPRESSED_BYTES = prevMaxBytes
    }
  })

  test('region-files.importBed rejects raw server paths even with the legacy allow flag', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
    process.env.NODE_ENV = 'test'
    process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = '1'
    try {
      const { deps, writeExecute, reply } = makeDeps()
      const { overrides } = buildDispatcher(deps)
      const request = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }

      const result = await overrides['region-files:importBed'].handle(
        [4, '/tmp/regions.bed'],
        request as never,
        reply as never,
        deps
      )

      expect(reply.code).toHaveBeenCalledWith(403)
      expect(result).toMatchObject({ error: 'server-path-import-disabled' })
      expect(writeExecute).not.toHaveBeenCalled()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT
      else process.env.VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT = prevAllow
    }
  })

  test('gene-lists.setGenes writes genes and returns the refreshed list', async () => {
    const { deps, execute, writeExecute, reply } = makeDeps()
    execute.mockResolvedValueOnce(['BRCA1', 'TP53'])
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['gene-lists:setGenes'].handle(
      [3, ['BRCA1', 'TP53']],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).not.toHaveBeenCalled()
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'gene-lists:setGenes',
      params: [3, ['BRCA1', 'TP53']]
    })
    expect(execute).toHaveBeenCalledWith({
      type: 'gene-lists:getGenes',
      params: [3]
    })
    expect(result).toEqual(['BRCA1', 'TP53'])
  })

  test('browser-incompatible exports fail explicitly instead of returning row streams', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['export:variants'].handle(
      [{ case_id: 7 }],
      {} as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'export.variants',
      message: 'export.variants is not available in web mode yet.'
    })
    expect(execute).not.toHaveBeenCalled()
  })

  test('browser-incompatible cohort exports fail explicitly instead of returning row streams', async () => {
    const { deps, execute, reply } = makeDeps()
    const { overrides } = buildDispatcher(deps)

    const result = await overrides['export:cohort'].handle([{}], {} as never, reply as never, deps)

    expect(reply.code).toHaveBeenCalledWith(501)
    expect(result).toEqual({
      error: 'unsupported-web-capability',
      capability: 'export.cohort',
      message: 'export.cohort is not available in web mode yet.'
    })
    expect(execute).not.toHaveBeenCalled()
  })
})
