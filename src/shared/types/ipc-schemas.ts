/**
 * Zod schemas for IPC parameter validation (ANTI-07)
 *
 * Provides runtime type validation at IPC boundaries for high-risk handlers.
 * Schemas match the TypeScript types in cohort.ts and database/types.ts.
 *
 * Best practice: Use .nullish() to accept both null and undefined from frontend,
 * then transform null to undefined to match TypeScript types.
 * See: https://zod.dev/api for nullish documentation
 *
 * Usage:
 * ```typescript
 * const result = CohortSearchParamsSchema.safeParse(params)
 * if (!result.success) {
 *   throw new Error(`Invalid params: ${result.error.message}`)
 * }
 * // result.data is typed and validated (nulls converted to undefined)
 * ```
 */

import { z } from 'zod'
import { DOMAIN_CONFIG } from '../config'

/**
 * Helper to create a nullish string that transforms null to undefined
 * Accepts: string | null | undefined -> outputs: string | undefined
 */
const nullishString = () =>
  z
    .string()
    .nullish()
    .transform((val) => val ?? undefined)

/**
 * Helper to create a nullish array that transforms null to undefined
 * Accepts: T[] | null | undefined -> outputs: T[] | undefined
 */
const nullishStringArray = () =>
  z
    .array(z.string())
    .nullish()
    .transform((val) => val ?? undefined)

const nullishNumberArray = () =>
  z
    .array(z.number().int().positive())
    .nullish()
    .transform((val) => val ?? undefined)

/**
 * Schema for cohort search parameters
 * Matches CohortSearchParams in src/shared/types/cohort.ts
 */
export const CohortSearchParamsSchema = z.object({
  // Pagination (optional per actual type)
  limit: z.number().int().positive().max(10000).optional(),
  // Cursor-based pagination (replaces offset)
  cursor: z
    .object({
      sort_value: z.union([z.number(), z.string(), z.null()]),
      sort_key: z.string().min(1),
      variant_key: z.string().min(1)
    })
    .nullish()
    .transform((val) => val ?? undefined),

  // Sorting (nullish - frontend may send null, transformed to undefined)
  sort_by: nullishString(),
  sort_order: z
    .enum(['asc', 'desc'])
    .nullish()
    .transform((val) => val ?? undefined),

  // Text filters (nullish - frontend may send null)
  search_term: nullishString(),
  gene_symbol: nullishString(),

  // Array filters (nullish - frontend may send null)
  consequences: nullishStringArray(),
  funcs: nullishStringArray(),
  clinvars: nullishStringArray(),

  // Numeric filters (validated ranges per ANTI-12, nullish)
  gnomad_af_max: z
    .number()
    .min(0)
    .max(1)
    .nullish()
    .transform((val) => val ?? undefined),
  cadd_min: z
    .number()
    .min(0)
    .max(DOMAIN_CONFIG.MAX_CADD_SCORE)
    .nullish()
    .transform((val) => val ?? undefined),
  cohort_frequency_min: z
    .number()
    .min(0)
    .max(1)
    .nullish()
    .transform((val) => val ?? undefined),
  carrier_count_min: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((val) => val ?? undefined),

  // Annotation filters
  starred_only: z.boolean().optional(),
  has_comment: z.boolean().optional(),
  acmg_classifications: nullishStringArray(),

  // Per-column text filters
  column_filters: z
    .record(z.string(), z.string())
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Inferred type from CohortSearchParamsSchema
 * Can be used instead of manually maintaining CohortSearchParams type
 */
export type ValidatedCohortSearchParams = z.infer<typeof CohortSearchParamsSchema>

/**
 * Schema for variant filter parameters (partial, without case_id)
 * Matches Omit<VariantFilter, 'case_id'> in src/main/database/types.ts
 *
 * Note: case_id is passed separately in variants:query IPC handler
 */
export const VariantFilterPartialSchema = z.object({
  // Text filters (nullish - frontend may send null)
  gene_symbol: nullishString(),
  search_query: nullishString(),

  // Single value filter (deprecated per type comment)
  consequence: nullishString(),

  // Array filters (nullish - frontend may send null)
  consequences: nullishStringArray(),
  funcs: nullishStringArray(),
  clinvars: nullishStringArray(),

  // Numeric filters (validated ranges, nullish)
  gnomad_af_max: z
    .number()
    .min(0)
    .max(1)
    .nullish()
    .transform((val) => val ?? undefined),
  cadd_min: z
    .number()
    .min(0)
    .max(DOMAIN_CONFIG.MAX_CADD_SCORE)
    .nullish()
    .transform((val) => val ?? undefined),

  // Exact match filters (for variant navigation)
  chr: nullishString(),
  pos: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((val) => val ?? undefined),
  ref: nullishString(),
  alt: nullishString(),

  // Tag filters
  tag_ids: nullishNumberArray(),

  // Annotation filters
  starred_only: z.boolean().optional(),
  has_comment: z.boolean().optional(),
  acmg_classifications: nullishStringArray(),

  // Per-column text filters
  column_filters: z
    .record(z.string(), z.string())
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Full variant filter schema including case_id
 * Matches VariantFilter in src/main/database/types.ts
 */
export const VariantFilterSchema = VariantFilterPartialSchema.extend({
  case_id: z.number().int().positive()
})

/**
 * Inferred type from VariantFilterSchema
 */
export type ValidatedVariantFilter = z.infer<typeof VariantFilterSchema>

/**
 * Schema for pagination cursor
 * Matches PaginationCursor in src/main/database/types.ts
 */
export const PaginationCursorSchema = z.object({
  id: z.number().int(),
  sort_value: z.union([z.number(), z.string(), z.null()]),
  sort_key: z.string()
})

/**
 * Inferred type from PaginationCursorSchema
 */
export type ValidatedPaginationCursor = z.infer<typeof PaginationCursorSchema>

/**
 * Schema for sort item
 * Matches SortItem in src/main/database/types.ts
 */
export const SortItemSchema = z.object({
  key: z.string(),
  order: z.enum(['asc', 'desc'])
})

/**
 * Inferred type from SortItemSchema
 */
export type ValidatedSortItem = z.infer<typeof SortItemSchema>

/**
 * Schema for case ID validation (used across multiple handlers)
 */
export const CaseIdSchema = z.number().int().positive()

/**
 * Schema for pagination limit
 */
export const LimitSchema = z.number().int().positive().max(1000)

/**
 * Schema for association analysis config
 * Matches AssociationConfig in src/main/statistics/types.ts
 */
export const AssociationConfigSchema = z.object({
  groupA_ids: z.array(z.number().int().positive()),
  groupB_ids: z.array(z.number().int().positive()),
  primary_test: z.enum(['fisher', 'logistic_burden']),
  weight_scheme: z.enum(['uniform', 'beta_maf', 'beta_maf_cadd']),
  covariates: z.array(z.string()),
  filters: z.object({
    gnomad_af_max: z.number().min(0).max(1).optional(),
    cadd_min: z.number().min(0).max(DOMAIN_CONFIG.MAX_CADD_SCORE).optional(),
    consequences: z.array(z.string()).optional(),
    gene_list: z.array(z.string()).optional()
  }),
  max_threads: z.number().int().min(1).max(64).default(4)
})
