/**
 * #498: staged uploads hold raw patient VCFs. They must not outlive the import
 * that used them, and a restart must not orphan them on disk.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import {
  clearStagedUploads,
  holdWebUploads,
  registerImportUploadRoutes,
  resolveWebUploadRef,
  stageExistingFileUpload,
  UPLOAD_FAILED_RETENTION_MS,
  UPLOAD_RELEASE_GRACE_MS,
  type StagedUpload
} from '../../src/web/server/routes/upload-staging'
import { makeDeps, startBatchAndAwaitResult } from './helpers/dispatcher-adapters'

const REQUEST = { session: { user: { id: 7, username: 'admin', role: 'admin' } } }
let root: string

async function stage(): Promise<StagedUpload> {
  const sourcePath = join(root, 'source.vcf')
  await writeFile(sourcePath, '##fileformat=VCFv4.2\n')
  return await stageExistingFileUpload({ userId: 7, originalName: 'input.vcf', sourcePath })
}

/** Jump past the release grace, then let the (real) directory removal finish. */
async function passGrace(): Promise<void> {
  await vi.advanceTimersByTimeAsync(UPLOAD_RELEASE_GRACE_MS + 1000)
  vi.useRealTimers()
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'varlens-upload-cleanup-'))
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VARLENS_WEB_UPLOAD_DIR', join(root, 'uploads'))
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('staged upload cleanup (#498)', () => {
  test('boot removes leftover user upload directories and nothing else', async () => {
    const upload = await stage()
    const orphan = join(root, 'uploads', '12', 'orphan-id')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, 'old.vcf'), 'x')
    await writeFile(join(root, 'uploads', 'not-ours.txt'), 'keep')

    await clearStagedUploads()

    expect(existsSync(upload.storedPath)).toBe(false)
    expect(existsSync(join(root, 'uploads', '12'))).toBe(false)
    expect(existsSync(join(root, 'uploads', 'not-ours.txt'))).toBe(true)
    expect(resolveWebUploadRef(upload.ref, 7)).toBeNull()
  })

  test('boot tolerates a missing upload root', async () => {
    await expect(clearStagedUploads()).resolves.toBeUndefined()
  })

  /** Run `import:start` twice on one ref, as a multi-sample VCF import does. */
  async function importTwice(upload: StagedUpload, fails: boolean): Promise<void> {
    const { deps, importSingleFile, reply } = makeDeps()
    if (fails) importSingleFile.mockRejectedValue(new Error('import failed'))
    const start = (): Promise<unknown> =>
      Promise.resolve(
        buildDispatcher(deps).overrides['import:start'].handle(
          [upload.ref, 'Case A'],
          REQUEST as never,
          reply as never,
          deps
        )
      ).catch(() => undefined)

    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    await start()
    await start()
    expect(importSingleFile).toHaveBeenCalledTimes(2)
    expect(existsSync(upload.storedPath)).toBe(true)
  }

  test('the staged directory is gone once its import succeeded', async () => {
    const upload = await stage()
    await importTwice(upload, false)

    await passGrace()
    await vi.waitFor(() => expect(existsSync(dirname(upload.storedPath))).toBe(false))
    expect(resolveWebUploadRef(upload.ref, 7)).toBeNull()
  })

  test('a failed import keeps the upload for a retry, for one hour', async () => {
    const upload = await stage()
    await importTwice(upload, true)
    expect(upload.expiresAt).toBe(Date.now() + UPLOAD_FAILED_RETENTION_MS)

    // Fix the option and retry after more than the release grace: no second upload.
    await vi.advanceTimersByTimeAsync(UPLOAD_RELEASE_GRACE_MS + 60_000)
    expect(resolveWebUploadRef(upload.ref, 7)?.storedPath).toBe(upload.storedPath)
    expect(existsSync(upload.storedPath)).toBe(true)

    // Swept by the timer the failed import set, not by a later request.
    await vi.advanceTimersByTimeAsync(UPLOAD_FAILED_RETENTION_MS)
    vi.useRealTimers()
    await vi.waitFor(() => expect(existsSync(dirname(upload.storedPath))).toBe(false))
    expect(resolveWebUploadRef(upload.ref, 7)).toBeNull()
  })

  test('a staging TTL shorter than one hour wins over the failed-import retention', async () => {
    vi.stubEnv('VARLENS_WEB_UPLOAD_TTL_MS', '60000')
    const upload = await stage()
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    holdWebUploads([upload.ref])(false)
    expect(upload.expiresAt).toBe(Date.now() + 60_000)
  })

  /** One staged upload per import route, with the call that imports it. */
  const ROUTES: Record<string, { name: string; args: (ref: string) => unknown[] }> = {
    'import:start': { name: 'input.vcf', args: (ref) => [ref, 'Case A'] },
    'import:startMultiFile': {
      name: 'input.vcf',
      args: (ref) => ['Case A', [{ filePath: ref, variantType: 'snv', caller: 'test' }]]
    },
    'batch-import:start': {
      name: 'Case B.json',
      args: (ref) => [[ref], 'skip', undefined, `settle-${Math.random()}`]
    },
    'region-files:importBed': { name: 'regions.bed', args: (ref) => [4, ref] }
  }

  for (const [route, { name, args }] of Object.entries(ROUTES)) {
    for (const fails of [false, true]) {
      test(`${route} settles its upload after ${fails ? 'a failure' : 'a success'}`, async () => {
        const sourcePath = join(root, 'source')
        await writeFile(sourcePath, '{}')
        const upload = await stageExistingFileUpload({ userId: 7, originalName: name, sourcePath })
        const { deps, importSingleFile, importMultiFile, writeExecute, reply } = makeDeps()
        if (fails) {
          for (const mock of [importSingleFile, importMultiFile, writeExecute]) {
            mock.mockRejectedValue(new Error('import failed'))
          }
        }
        const { overrides } = buildDispatcher(deps)
        const before = Date.now()
        await (route === 'batch-import:start'
          ? startBatchAndAwaitResult(overrides, args(upload.ref), REQUEST, reply, deps)
          : Promise.resolve(
              overrides[route].handle(args(upload.ref), REQUEST as never, reply as never, deps)
            ).catch(() => undefined))

        const retention = fails ? UPLOAD_FAILED_RETENTION_MS : UPLOAD_RELEASE_GRACE_MS
        expect(reply.code).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(upload.expiresAt).toBeLessThanOrEqual(Date.now() + retention))
        expect(upload.expiresAt).toBeGreaterThanOrEqual(before + retention)
      })
    }
  }

  test('a batch import retires its uploads when the background job settles', async () => {
    const sourcePath = join(root, 'Case B.json')
    await writeFile(sourcePath, '{}')
    const upload = await stageExistingFileUpload({
      userId: 7,
      originalName: 'Case B.json',
      sourcePath
    })
    const { deps, reply } = makeDeps()
    await startBatchAndAwaitResult(
      buildDispatcher(deps).overrides,
      [[upload.ref], 'skip', undefined, 'cleanup-run-1'],
      REQUEST,
      reply,
      deps
    )

    // Still inside the 24 h staging TTL: only the release makes it expire.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + UPLOAD_RELEASE_GRACE_MS + 1000)
    expect(resolveWebUploadRef(upload.ref, 7)).toBeNull()
  })

  test('an upload in use is kept, however long its import runs', async () => {
    const upload = await stage()
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const first = holdWebUploads([upload.ref])
    const second = holdWebUploads([upload.ref])
    first()
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
    expect(resolveWebUploadRef(upload.ref, 7)?.storedPath).toBe(upload.storedPath)
    expect(existsSync(upload.storedPath)).toBe(true)

    second()
    await passGrace()
    await vi.waitFor(() => expect(existsSync(dirname(upload.storedPath))).toBe(false))
  })

  test('uploading is refused while a password rotation is pending', async () => {
    const { deps } = makeDeps()
    const app = fastify()
    app.addHook('preHandler', async (request) => {
      request.session = { ...REQUEST.session, mustChangePassword: true } as never
    })
    registerImportUploadRoutes(app, deps)
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/import/upload',
        headers: { 'content-type': 'application/octet-stream', 'x-varlens-file-name': 'a.vcf' },
        payload: Buffer.from('##fileformat=VCFv4.2\n')
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ message: 'password-rotation-required' })
      expect(existsSync(join(root, 'uploads'))).toBe(false)
    } finally {
      await app.close()
    }
  })
})
