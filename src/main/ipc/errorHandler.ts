import { SerializableError, ErrorCode } from '../../shared/types/errors'
import { DatabaseError, NotFoundError, UniqueConstraintError } from '../database/errors'

/**
 * Convert any error to a serializable format for IPC transport.
 * Electron IPC only serializes error.message, so we convert to plain objects.
 */
export function toSerializableError(error: unknown): SerializableError {
  // Handle known database errors
  if (error instanceof NotFoundError) {
    return {
      code: ErrorCode.NOT_FOUND,
      message: error.message,
      userMessage: error.message, // Already user-friendly
      details: { cause: error.cause?.message }
    }
  }

  if (error instanceof UniqueConstraintError) {
    return {
      code: ErrorCode.UNIQUE_CONSTRAINT,
      message: error.message,
      userMessage: error.message // Already user-friendly
    }
  }

  if (error instanceof DatabaseError) {
    return {
      code: ErrorCode.DB_ERROR,
      message: error.message,
      userMessage: 'A database error occurred. Please try again.',
      details: { cause: error.cause?.message }
    }
  }

  // Handle abort/cancellation
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: ErrorCode.CANCELLED,
      message: 'Operation cancelled',
      userMessage: 'The operation was cancelled.'
    }
  }

  // Handle file not found
  if (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return {
      code: ErrorCode.FILE_NOT_FOUND,
      message: error.message,
      userMessage: 'File not found. Please check the path and try again.'
    }
  }

  // Handle parse errors
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.message.includes('parse') === true)
  ) {
    return {
      code: ErrorCode.PARSE_ERROR,
      message: error instanceof Error ? error.message : String(error),
      userMessage: 'Failed to parse the file. Please check the file format.'
    }
  }

  // Unknown error fallback
  return {
    code: ErrorCode.UNKNOWN,
    message: error instanceof Error ? error.message : String(error),
    userMessage: 'An unexpected error occurred. Please try again.'
  }
}

/**
 * Wrap an IPC handler function to catch errors and convert to serializable format.
 * Use this around all ipcMain.handle callbacks.
 */
export async function wrapHandler<T>(handler: () => Promise<T>): Promise<T | SerializableError> {
  try {
    return await handler()
  } catch (error) {
    console.error('IPC handler error:', error)
    return toSerializableError(error)
  }
}
