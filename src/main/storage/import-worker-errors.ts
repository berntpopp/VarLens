import { AppError } from '../ipc/errors'
import { toSerializableError } from '../ipc/serializable-error'
import { ErrorCode } from '../../shared/types/errors'

const KNOWN_ERROR_CODES = new Set<string>(Object.values(ErrorCode))
/** Codes that carry meaning for the caller; anything else stays a plain Error. */
const TYPED_WORKER_CODES = new Set<string>([
  ErrorCode.CONFLICT,
  ErrorCode.NOT_FOUND,
  ErrorCode.FILE_NOT_FOUND,
  ErrorCode.VALIDATION,
  ErrorCode.INVALID_PARAMETERS,
  ErrorCode.PARSE_ERROR,
  ErrorCode.RESOURCE_LIMIT
])

const RESOURCE_LIMIT_USER_MESSAGE =
  'The import ran out of memory and was stopped. The file contains records too large to ' +
  'import on this machine; nothing from it was kept.'

/** An import worker was stopped at its heap limit (`ERR_WORKER_OUT_OF_MEMORY`). */
export class ImportResourceLimitError extends AppError {
  constructor(message: string) {
    super(ErrorCode.RESOURCE_LIMIT, message, RESOURCE_LIMIT_USER_MESSAGE)
    this.name = 'ImportResourceLimitError'
  }
}

/**
 * Main side: describe the `error` event of a worker thread. A worker stopped
 * at its heap limit becomes a typed `RESOURCE_LIMIT` failure; any other crash
 * stays an unclassified message.
 */
export function describeWorkerCrash(error: Error): WorkerErrorFields {
  if ((error as NodeJS.ErrnoException).code !== 'ERR_WORKER_OUT_OF_MEMORY') {
    return { message: error.message }
  }
  const typed = new ImportResourceLimitError(`Import exceeded its memory budget: ${error.message}`)
  return { message: typed.message, code: typed.code, userMessage: typed.userMessage }
}

/** Wire form of an import failure: the message plus its envelope code. */
export interface WorkerErrorFields {
  message: string
  code?: string
  userMessage?: string
}

/**
 * Worker side: the envelope code of a failure, so it survives the thread hop.
 * Empty for unclassified failures — those stay plain messages on the wire.
 */
export function classifyWorkerError(
  error: unknown
): Pick<WorkerErrorFields, 'code' | 'userMessage'> {
  const classified = toSerializableError(error)
  if (!TYPED_WORKER_CODES.has(classified.code)) return {}
  return { code: classified.code, userMessage: classified.userMessage }
}

/**
 * Main side: rebuild a typed error from a worker failure, so a duplicate case
 * name stays `CONFLICT` (409 in web) on both the SQLite and Postgres import
 * paths instead of becoming a generic failure.
 */
export function workerErrorToError(fields: WorkerErrorFields): Error {
  const code = fields.code
  if (code === ErrorCode.RESOURCE_LIMIT) return new ImportResourceLimitError(fields.message)
  if (code !== undefined && KNOWN_ERROR_CODES.has(code) && TYPED_WORKER_CODES.has(code)) {
    return new AppError(code as ErrorCode, fields.message, fields.userMessage ?? fields.message)
  }
  return new Error(fields.message)
}
