import { ErrorCode } from '../../shared/types/errors'

/**
 * Error class for IPC payload validation failures.
 *
 * Throw from a handler when a `safeParse` against an ipc-schemas.ts
 * schema returns `.success === false`. `wrapHandler` will catch it and
 * `toSerializableError` will map it to a SerializableError with
 * code === ErrorCode.INVALID_PARAMETERS.
 */
export class InvalidParametersError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string = 'The request contained invalid parameters.'
  ) {
    super(message)
    this.name = 'InvalidParametersError'
  }
}

/**
 * An error that already knows its envelope code (desktop/web parity spec
 * §4.4). `toSerializableError` passes `code` and `userMessage` through
 * unchanged, and the web dispatcher derives the HTTP status from `code`.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly userMessage: string = message
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** The caller is authenticated but not allowed to act on this resource. */
export class ForbiddenError extends AppError {
  constructor(message: string, userMessage = 'You are not allowed to perform this action.') {
    super(ErrorCode.FORBIDDEN, message, userMessage)
    this.name = 'ForbiddenError'
  }
}

/** The request clashes with existing state (duplicate name, job already running). */
export class ConflictError extends AppError {
  constructor(message: string, userMessage: string = message) {
    super(ErrorCode.CONFLICT, message, userMessage)
    this.name = 'ConflictError'
  }
}
