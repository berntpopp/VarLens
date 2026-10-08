/**
 * #498: a per-user cap on staged bytes (VARLENS_WEB_MAX_STAGED_BYTES_PER_USER),
 * for direct uploads and for the files a batch ZIP is extracted into.
 */
import { readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { buildDispatcher } from '../../src/web/server/dispatcher'
import {
  clearStagedUploads,
  registerImportUploadRoutes,
  resolveWebUploadRef,
  stageExistingFileUpload
} from '../../src/web/server/routes/upload-staging'
import { writePlainZip } from '../utils/zip-fixtures'
import { makeDeps } from './helpers/dispatcher-adapters'

let root: string
let app: FastifyInstance

/** Upload directories (one per staged file) a user has on disk. */
const stagedDirs = (userId: number): string[] => {
  try {
    return readdirSync(join(root, 'uploads', String(userId)))
  } catch {
    return []
  }
}

const upload = (userId: number, bytes: number): ReturnType<FastifyInstance['inject']> =>
  app.inject({
    method: 'POST',
    url: '/api/import/upload',
    headers: {
      'content-type': 'application/octet-stream',
      'x-varlens-file-name': 'a.vcf',
      'x-test-user': String(userId)
    },
    payload: Buffer.alloc(bytes, 'x')
  })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'varlens-upload-quota-'))
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VARLENS_WEB_UPLOAD_DIR', join(root, 'uploads'))
  await clearStagedUploads()
  app = fastify()
  app.addHook('preHandler', async (request) => {
    const id = Number(request.headers['x-test-user'])
    request.session = { user: { id, username: `u${id}`, role: 'admin' } } as never
  })
  registerImportUploadRoutes(app, makeDeps().deps)
})

afterEach(async () => {
  await app.close()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('per-user staged bytes cap (#498)', () => {
  test('counts all uploads of one user, and only that user', async () => {
    vi.stubEnv('VARLENS_WEB_MAX_STAGED_BYTES_PER_USER', '10')

    expect((await upload(7, 6)).statusCode).toBe(200)
    expect((await upload(7, 4)).statusCode).toBe(200)

    const refused = await upload(7, 1)
    expect(refused.statusCode).toBe(413)
    expect(refused.json()).toMatchObject({ error: 'upload-quota-exceeded' })
    expect(refused.json().message).toContain('10 byte')
    expect(stagedDirs(7)).toHaveLength(2)

    expect((await upload(8, 6)).statusCode).toBe(200)
  })

  test('a single upload over the cap leaves nothing on disk', async () => {
    vi.stubEnv('VARLENS_WEB_MAX_STAGED_BYTES_PER_USER', '10')

    expect((await upload(7, 11)).statusCode).toBe(413)
    expect(stagedDirs(7)).toEqual([])
  })

  test('the default cap is far above one upload', async () => {
    expect((await upload(7, 64)).statusCode).toBe(200)
  })

  test('ZIP extraction over the cap is refused and its staged files are removed', async () => {
    const entry = '{"variants":[]}'
    const zipPath = join(root, 'cases.zip')
    writePlainZip(zipPath, { 'HG001.json': entry, 'HG002.json': entry })
    const zip = await stageExistingFileUpload({
      userId: 7,
      originalName: 'cases.zip',
      sourcePath: zipPath
    })
    // Room for the archive and the first extracted case, not the second.
    vi.stubEnv('VARLENS_WEB_MAX_STAGED_BYTES_PER_USER', String(zip.size + entry.length + 1))

    const { deps, reply } = makeDeps()
    const result = await buildDispatcher(deps).overrides['batch-import:extractZip'].handle(
      [zip.ref, ''],
      { session: { user: { id: 7, username: 'u7', role: 'admin' } } } as never,
      reply as never,
      deps
    )

    expect(reply.code).toHaveBeenCalledWith(413)
    expect(result).toMatchObject({ error: 'upload-quota-exceeded' })
    await vi.waitFor(() => expect(stagedDirs(7)).toEqual([zip.id]))
    // The archive itself stays: the user can free space and extract again.
    expect(resolveWebUploadRef(zip.ref, 7)?.storedPath).toBe(zip.storedPath)
  })
})
