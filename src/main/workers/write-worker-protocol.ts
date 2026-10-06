import type { EncodedWorkerError } from '../database/worker-error-codec'
import type { StorageWriteTask } from '../storage/write-executor'

/** Data the write worker needs to open its connection. */
export interface WriteWorkerData {
  dbPath: string
  encryptionKey?: string
}

/** Main → write worker. */
export interface WriteWorkerRequest {
  id: number
  task: StorageWriteTask
}

/** Write worker → main. */
export type WriteWorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: EncodedWorkerError }
