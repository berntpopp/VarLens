/**
 * Closed set of error codes carried by {@link SerializableError}.
 *
 * The first block is the envelope from the desktop/web parity spec (§4.4):
 * every code maps to exactly one HTTP status in the web dispatcher
 * (`src/shared/errors/error-status.ts`). The second block holds the older,
 * more specific codes that pre-date the envelope; they keep their meaning
 * (renderer code may branch on them) and map onto the same status table.
 */
export enum ErrorCode {
  VALIDATION = 'VALIDATION',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  FORBIDDEN = 'FORBIDDEN',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  UNSUPPORTED_RUNTIME = 'UNSUPPORTED_RUNTIME',
  UNAVAILABLE_UPSTREAM = 'UNAVAILABLE_UPSTREAM',
  CANCELLED = 'CANCELLED',
  INTERNAL = 'INTERNAL',

  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  DB_ERROR = 'DB_ERROR',
  /** @deprecated Unique violations are reported as {@link ErrorCode.CONFLICT}. */
  UNIQUE_CONSTRAINT = 'UNIQUE_CONSTRAINT',
  WRONG_PASSWORD = 'WRONG_PASSWORD',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
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
