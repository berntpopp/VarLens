/**
 * Worker thread for ZIP archive work. adm-zip is fully synchronous: it reads
 * the whole archive into memory and inflates entries on the calling thread.
 *
 * Running it here keeps up to 256 MB reads / 512 MB inflation off the
 * Electron main thread and the web server's event loop (audit 05, W-3).
 * Resource limits and path validation stay in {@link ZipExtractor}.
 */
import { parentPort } from 'worker_threads'
import { ZipExtractor, type ZipExtractionResult } from './ZipExtractor'
import type { ZipWorkerRequest, ZipWorkerResponse } from './zip-worker-protocol'

if (!parentPort) throw new Error('Must be run as worker thread')

const port = parentPort
const extractor = new ZipExtractor()

async function handle(request: ZipWorkerRequest): Promise<boolean | ZipExtractionResult> {
  switch (request.op) {
    case 'isEncrypted':
      return extractor.isEncrypted(request.zipPath)
    case 'testPassword':
      return extractor.testPassword(request.zipPath, request.password)
    case 'extract':
      return await extractor.extract(request.zipPath, request.targetDir, request.password)
  }
}

port.once('message', (request: ZipWorkerRequest) => {
  handle(request).then(
    (result) => port.postMessage({ ok: true, result } satisfies ZipWorkerResponse),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error)
        }
      } satisfies ZipWorkerResponse)
  )
})
