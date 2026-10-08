import type { SelectQueryBuilder } from 'kysely'
import type { VarlensDatabase } from '../../../shared/types/database-schema'
import type { SortItem } from '../types'

/**
 * Kysely query builder type for variant queries.
 * Uses `any` for the table union to accommodate the LEFT JOIN alias ('vf')
 * and the computed `internal_af` column which isn't in any physical table schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VariantQueryBuilder = SelectQueryBuilder<VarlensDatabase, any, Record<string, unknown>>

/** Options accepted by `VariantFilterBuilder.build()`. */
export interface VariantFilterBuildOptions {
  /** Compiled queries: no temp table, so panel intervals bind as one JSON parameter. */
  forceOrChain?: boolean
  /** Sort keys, used only to pre-compute the extension-table JOINs they need. */
  sortBy?: SortItem[]
}
