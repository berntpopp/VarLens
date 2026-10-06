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
import { ColumnFilterValueError } from '../../shared/filters/column-filter-validation'
import { PanelRegionsUnavailableError } from '../../shared/filters/panel-intervals'

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
  ForbiddenError,
  ColumnFilterValueError,
  PanelRegionsUnavailableError
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

function isEncodedWorkerError(value: unknown): value is EncodedWorkerError {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' && typeof record.message === 'string'
}

/**
 * Wrap an error for a transport that only structured-clones the thrown value
 * (the Piscina read pool). Structured clone keeps `message`, `stack` and
 * `cause` of an `Error` but drops its class and custom fields, so the encoded
 * form travels in `cause`.
 */
export function toTransportableWorkerError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const plain = new Error(error.message, { cause: encodeWorkerError(error) })
  plain.stack = error.stack
  return plain
}

/** Inverse of {@link toTransportableWorkerError}; other values pass through. */
export function fromTransportableWorkerError(error: unknown): unknown {
  if (error instanceof Error && isEncodedWorkerError(error.cause)) {
    return decodeWorkerError(error.cause)
  }
  return error
}
