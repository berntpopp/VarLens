export enum ErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  DB_ERROR = 'DB_ERROR',
  CANCELLED = 'CANCELLED',
  NOT_FOUND = 'NOT_FOUND',
  UNIQUE_CONSTRAINT = 'UNIQUE_CONSTRAINT',
  WRONG_PASSWORD = 'WRONG_PASSWORD',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  /** The session's role may not call this method (web client / dispatcher). */
  FORBIDDEN = 'FORBIDDEN',
  /** The method is desktop-only or not yet served in this runtime (parity manifest). */
  UNSUPPORTED_RUNTIME = 'UNSUPPORTED_RUNTIME',
  UNKNOWN = 'UNKNOWN'
}

export interface SerializableError {
  code: ErrorCode
  message: string
  userMessage: string
  details?: Record<string, unknown>
}

// Discriminated union result type for IPC responses
export type IpcResult<T> = T | SerializableError

// Type guard to check if result is an error
export function isIpcError(result: unknown): result is SerializableError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'code' in result &&
    'message' in result &&
    'userMessage' in result
  )
}

/**
 * Unwrap an IPC result, throwing if it is a SerializableError.
 * Use in renderer code where the caller wants the success value
 * and can let an error propagate to a catch handler.
 */
export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (isIpcError(result)) {
    throw result
  }
  return result
}
