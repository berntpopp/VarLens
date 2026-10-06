/**
 * ZIP inspection / password test / extraction run in a worker thread
 * (audit 05, W-3). Exercises the real bundled zip worker.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import {
  extractZipOffThread,
  isZipEncryptedOffThread,
  setZipWorkerPathForTesting,
  testZipPasswordOffThread
} from '../../../src/main/import/zip-worker-client'
import { bundleWorker } from '../../utils/bundle-worker'

describe('zip worker client', () => {
  let dir: string

  beforeAll(async () => {
    setZipWorkerPathForTesting(await bundleWorker('src/main/import/zip-worker.ts'))
    dir = mkdtempSync(join(tmpdir(), 'varlens-zip-worker-'))
  }, 60_000)

  afterAll(() => {
    setZipWorkerPathForTesting(undefined)
    rmSync(dir, { recursive: true, force: true })
  })

  it('inspects and extracts an archive in the worker', async () => {
    const zipPath = join(dir, 'cases.zip')
    const zip = new AdmZip()
    zip.addFile('case-a.json', Buffer.from('{"variants":[]}'))
    zip.writeZip(zipPath)

    expect(await isZipEncryptedOffThread(zipPath)).toBe(false)
    expect(await testZipPasswordOffThread(zipPath, 'unused')).toBe(false)

    const target = mkdtempSync(join(dir, 'out-'))
    const result = await extractZipOffThread(zipPath, target)
    expect(result.errors).toEqual([])
    expect(result.extractedFiles).toHaveLength(1)
    expect(existsSync(result.extractedFiles[0])).toBe(true)
    expect(readFileSync(result.extractedFiles[0], 'utf8')).toBe('{"variants":[]}')
  })

  it('propagates extractor errors across the worker boundary', async () => {
    const garbage = join(dir, 'garbage.zip')
    writeFileSync(garbage, 'not a zip')

    await expect(isZipEncryptedOffThread(garbage)).rejects.toThrow(/Failed to inspect ZIP archive/)
    await expect(testZipPasswordOffThread(garbage, 'x')).rejects.toThrow(/Failed to open ZIP/)
  })
})
