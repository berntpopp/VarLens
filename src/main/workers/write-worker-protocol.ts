import type { EncodedWorkerError } from '../database/worker-error-codec'
import type { StorageWriteTask } from '../storage/write-executor'
import type { AuthWriteOp } from '../services/auth/auth-writes'

/** Data the write worker needs to open its connection. */
export interface WriteWorkerData {
  dbPath: string
  encryptionKey?: string
}

/** Main → write worker: a storage write task, or a desktop auth write. */
export type WriteWorkerRequest =
  { id: number; task: StorageWriteTask } | { id: number; auth: AuthWriteOp }

/** Write worker → main. */
export type WriteWorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: EncodedWorkerError }
