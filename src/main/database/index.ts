/**
 * Database module barrel export
 *
 * Public API for the Varlens database layer.
 */

// Service
export { DatabaseService } from './DatabaseService'

// Types
export type { Case, Variant, VariantFilter, PaginationCursor, PaginatedResult } from './types'

// Errors
export { DatabaseError, NotFoundError, UniqueConstraintError, TransactionError } from './errors'
