import { SerializableError, ErrorCode } from '../../shared/types/errors'
import {
  DatabaseError,
  NotFoundError,
  UniqueConstraintError,
  WrongPasswordError
} from '../database/errors'
import { AppError, InvalidParametersError } from './errors'
import { uniqueViolationFromDriverError } from './unique-violation'
import { ColumnFilterValueError } from '../../shared/filters/column-filter-validation'
import { PanelRegionsUnavailableError } from '../../shared/filters/panel-intervals'

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

function conflict(message: string, userMessage: string): SerializableError {
  return { code: ErrorCode.CONFLICT, message, userMessage }
}

/**
 * Convert any application error to the renderer-facing SerializableError shape.
 * Shared by Electron IPC and the web dispatcher so both runtimes classify
 * domain errors identically: a Postgres `23505`, a SQLite
 * `SQLITE_CONSTRAINT_UNIQUE` and a repository `UniqueConstraintError` all
 * become `CONFLICT` (HTTP 409 in web).
 */
export function toSerializableError(error: unknown): SerializableError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, userMessage: error.userMessage }
  }

  // Filter requests the backend refuses to run. Both carry a message written
  // for the user, so it is passed through instead of a generic fallback.
  if (error instanceof PanelRegionsUnavailableError) {
    return { code: ErrorCode.VALIDATION, message: error.message, userMessage: error.userMessage }
  }
  if (error instanceof ColumnFilterValueError) {
    return { code: ErrorCode.VALIDATION, message: error.message, userMessage: error.message }
  }

  if (error instanceof WrongPasswordError) {
    return {
      code: ErrorCode.WRONG_PASSWORD,
      message: error.message,
      userMessage: 'Incorrect password for encrypted database.'
    }
  }

  if (error instanceof NotFoundError) {
    return {
      code: ErrorCode.NOT_FOUND,
      message: error.message,
      userMessage: error.message,
      details: { cause: error.cause?.message }
    }
  }

  if (error instanceof UniqueConstraintError) {
    // Built from the message ("name 'X' already exists") rather than fields,
    // so the class rehydrated by worker-error-codec reads the same.
    return conflict(error.message, `${capitalize(error.message)}. Choose a different name.`)
  }

  const driverConflict =
    uniqueViolationFromDriverError(error) ??
    (error instanceof Error ? uniqueViolationFromDriverError(error.cause) : undefined)
  if (driverConflict !== undefined) {
    return conflict(driverConflict.message, driverConflict.userMessage)
  }

  if (error instanceof DatabaseError) {
    return {
      code: ErrorCode.DB_ERROR,
      message: error.message,
      userMessage: 'A database error occurred. Please try again.',
      details: { cause: error.cause?.message }
    }
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: ErrorCode.CANCELLED,
      message: 'Operation cancelled',
      userMessage: 'The operation was cancelled.'
    }
  }

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

  if (error instanceof InvalidParametersError) {
    return {
      code: ErrorCode.INVALID_PARAMETERS,
      message: error.message,
      userMessage: error.userMessage
    }
  }

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

  return {
    code: ErrorCode.UNKNOWN,
    message: error instanceof Error ? error.message : String(error),
    userMessage: 'An unexpected error occurred. Please try again.'
  }
}
