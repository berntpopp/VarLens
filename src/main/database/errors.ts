/**
 * Custom error classes for database operations
 *
 * These errors provide typed error handling for database operations.
 * Each class uses Object.setPrototypeOf for proper instanceof checks.
 */

/**
 * Base error class for all database errors
 */
export class DatabaseError extends Error {
  /**
   * Create a DatabaseError
   * @param message - Error message
   * @param cause - Optional wrapped error
   */
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'DatabaseError'
    Object.setPrototypeOf(this, DatabaseError.prototype)
  }
}

/**
 * Error thrown when a requested resource is not found
 */
export class NotFoundError extends DatabaseError {
  /**
   * Create a NotFoundError
   * @param resource - Type of resource (e.g., "Case", "Variant")
   * @param id - ID of the missing resource
   */
  constructor(resource: string, id: number | string) {
    super(`${resource} with id ${id} not found`)
    this.name = 'NotFoundError'
    Object.setPrototypeOf(this, NotFoundError.prototype)
  }
}

/**
 * Error thrown when a unique constraint is violated
 */
export class UniqueConstraintError extends DatabaseError {
  /**
   * Create a UniqueConstraintError
   * @param field - Name of the field with the constraint
   * @param value - Value that violated the constraint
   */
  constructor(field: string, value: string) {
    super(`${field} '${value}' already exists`)
    this.name = 'UniqueConstraintError'
    Object.setPrototypeOf(this, UniqueConstraintError.prototype)
  }
}

/**
 * Error thrown when a transaction fails
 */
export class TransactionError extends DatabaseError {
  /**
   * Create a TransactionError
   * @param message - Error message describing the transaction failure
   * @param cause - Optional wrapped error
   */
  constructor(message: string, cause?: Error) {
    super(message, cause)
    this.name = 'TransactionError'
    Object.setPrototypeOf(this, TransactionError.prototype)
  }
}

/**
 * Error thrown when wrong password is provided for encrypted database
 */
export class WrongPasswordError extends DatabaseError {
  /**
   * Create a WrongPasswordError
   */
  constructor() {
    super('Wrong password or database is not encrypted')
    this.name = 'WrongPasswordError'
    Object.setPrototypeOf(this, WrongPasswordError.prototype)
  }
}

/**
 * Error thrown for general encryption failures
 */
export class EncryptionError extends DatabaseError {
  /**
   * Create an EncryptionError
   * @param message - Error message describing the encryption failure
   * @param cause - Optional wrapped error
   */
  constructor(message: string, cause?: Error) {
    super(message, cause)
    this.name = 'EncryptionError'
    Object.setPrototypeOf(this, EncryptionError.prototype)
  }
}
