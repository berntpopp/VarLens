import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Worker } from 'worker_threads'
import { ZipExtractor, type ZipExtractionResult } from './ZipExtractor'
import type { ZipWorkerRequest, ZipWorkerResponse } from './zip-worker-protocol'

/**
 * Runs {@link ZipExtractor} operations in a short-lived worker thread.
 *
 * Bundle lookup covers the Electron main build (`zip-worker.js`) and the web
 * server build (`zip-worker.cjs`). When neither bundle exists — only under
 * Vitest, which runs the TypeScript sources directly — the operation runs in
 * process so unit tests keep exercising the real extractor.
 */
const DEFAULT_CANDIDATES = [
  resolve(__dirname, 'zip-worker.js'),
  resolve(__dirname, 'zip-worker.cjs')
]

let workerPathOverride: string | null | undefined

/** Test hook: force a worker bundle path, `null` for in-process, `undefined` to reset. */
export function setZipWorkerPathForTesting(path: string | null | undefined): void {
  workerPathOverride = path
}

function resolveWorkerPath(): string | null {
  if (workerPathOverride !== undefined) return workerPathOverride
  return DEFAULT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null
}

async function runInProcess(request: ZipWorkerRequest): Promise<boolean | ZipExtractionResult> {
  const extractor = new ZipExtractor()
  switch (request.op) {
    case 'isEncrypted':
      return extractor.isEncrypted(request.zipPath)
    case 'testPassword':
      return extractor.testPassword(request.zipPath, request.password)
    case 'extract':
      return await extractor.extract(request.zipPath, request.targetDir, request.password)
  }
}

function runZipTask(request: ZipWorkerRequest): Promise<boolean | ZipExtractionResult> {
  const workerPath = resolveWorkerPath()
  if (workerPath === null) return runInProcess(request)

  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(workerPath)
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
      void worker.terminate()
    }
    worker.once('message', (response: ZipWorkerResponse) => {
      settle(() => {
        if (response.ok) {
          resolvePromise(response.result)
          return
        }
        const error = new Error(response.error.message)
        error.name = response.error.name
        reject(error)
      })
    })
    worker.once('error', (error) => settle(() => reject(error)))
    worker.once('exit', (code) =>
      settle(() => reject(new Error(`ZIP worker exited unexpectedly with code ${code}`)))
    )
    worker.postMessage(request)
  })
}

export async function isZipEncryptedOffThread(zipPath: string): Promise<boolean> {
  return (await runZipTask({ op: 'isEncrypted', zipPath })) as boolean
}

export async function testZipPasswordOffThread(
  zipPath: string,
  password: string
): Promise<boolean> {
  return (await runZipTask({ op: 'testPassword', zipPath, password })) as boolean
}

export async function extractZipOffThread(
  zipPath: string,
  targetDir: string,
  password?: string
): Promise<ZipExtractionResult> {
  return (await runZipTask({ op: 'extract', zipPath, targetDir, password })) as ZipExtractionResult
}
