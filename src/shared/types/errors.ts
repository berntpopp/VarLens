export enum ErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  DB_ERROR = 'DB_ERROR',
  CANCELLED = 'CANCELLED',
  NOT_FOUND = 'NOT_FOUND',
  UNIQUE_CONSTRAINT = 'UNIQUE_CONSTRAINT',
  WRONG_PASSWORD = 'WRONG_PASSWORD',
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
