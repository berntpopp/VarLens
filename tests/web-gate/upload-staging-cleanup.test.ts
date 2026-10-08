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

  test('a failed import keeps the upload for a retry, until the staging TTL', async () => {
    const upload = await stage()
    await importTwice(upload, true)

    // Fix the option and retry after more than the release grace: no second upload.
    await vi.advanceTimersByTimeAsync(UPLOAD_RELEASE_GRACE_MS + 60_000)
    expect(resolveWebUploadRef(upload.ref, 7)?.storedPath).toBe(upload.storedPath)
    expect(existsSync(upload.storedPath)).toBe(true)

    // Not for ever: like an upload nobody imported (its own sweep timer was
    // set before the clock was faked; any later access sweeps as well).
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(resolveWebUploadRef(upload.ref, 7)).toBeNull()
    vi.useRealTimers()
    await vi.waitFor(() => expect(existsSync(dirname(upload.storedPath))).toBe(false))
  })

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
