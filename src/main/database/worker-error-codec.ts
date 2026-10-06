/**
 * Error transport across the worker-thread boundary.
 *
 * Structured clone drops custom prototypes, so a `UniqueConstraintError`
 * thrown in the write worker would arrive on the main thread as a plain
 * `Error` and `toSerializableError` would classify it as UNKNOWN. This codec
 * carries the class name (plus `code`, `userMessage` and the cause message)
 * and restores the original class so IPC error mapping is unchanged.
 */
import {
  DatabaseError,
  EncryptionError,
  NotFoundError,
  TransactionError,
  UniqueConstraintError,
  WrongPasswordError
} from './errors'
import { AppError, ConflictError, ForbiddenError, InvalidParametersError } from '../ipc/errors'

export interface EncodedWorkerError {
  name: string
  message: string
  stack?: string
  code?: string
  userMessage?: string
  causeMessage?: string
}

const KNOWN_CLASSES: Record<string, { prototype: Error }> = {
  DatabaseError,
  EncryptionError,
  NotFoundError,
  TransactionError,
  UniqueConstraintError,
  WrongPasswordError,
  InvalidParametersError,
  AppError,
  ConflictError,
  ForbiddenError
}

export function encodeWorkerError(error: unknown): EncodedWorkerError {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) }
  }
  const record = error as Error & { code?: unknown; userMessage?: unknown; cause?: unknown }
  return {
    name: error.name,
    message: error.message,
    ...(error.stack !== undefined ? { stack: error.stack } : {}),
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
    ...(typeof record.userMessage === 'string' ? { userMessage: record.userMessage } : {}),
    ...(record.cause instanceof Error ? { causeMessage: record.cause.message } : {})
  }
}

export function decodeWorkerError(encoded: EncodedWorkerError): Error {
  const known = KNOWN_CLASSES[encoded.name]
  const error: Error = known !== undefined ? Object.create(known.prototype) : new Error()
  const target = error as Error & { code?: string; userMessage?: string; cause?: Error }
  Object.defineProperty(error, 'message', { value: encoded.message, writable: true })
  Object.defineProperty(error, 'name', { value: encoded.name, writable: true })
  if (encoded.stack !== undefined) {
    Object.defineProperty(error, 'stack', { value: encoded.stack, writable: true })
  }
  if (encoded.code !== undefined) target.code = encoded.code
  if (encoded.userMessage !== undefined) {
    Object.defineProperty(error, 'userMessage', { value: encoded.userMessage })
  }
  if (encoded.causeMessage !== undefined) {
    Object.defineProperty(error, 'cause', { value: new Error(encoded.causeMessage) })
  }
  return error
}
