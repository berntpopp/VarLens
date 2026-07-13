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
import { ACMG_CLASSIFICATIONS } from '../config/domain.config'
import { normalizeAcmgClassification } from '../utils/acmg'
export {
  UsernameSchema,
  PasswordSchema,
  LoginParamsSchema,
  CreateUserSchema,
  ChangePasswordSchema
} from '../api/schemas/auth'
export {
  TagIdSchema,
  TagCreateSchema,
  TagUpdateSchema,
  VariantTagAssignSchema,
  VariantTagSetSchema,
  TagCaseVariantIdSchema
} from '../api/schemas/tags'

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

/** Schema for a single typed column filter */
const ColumnFilterSchema = z.object({
  operator: z.enum(['=', '!=', '<', '>', '<=', '>=', 'like', 'in']),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
  includeEmpty: z.boolean().optional()
})

/**
 * Schema for cohort search parameters
 * Matches CohortSearchParams in src/shared/types/cohort.ts
 */
export const CohortSearchParamsSchema = z.object({
  // Pagination (optional per actual type)
  limit: z.number().int().positive().max(10000).optional(),
  // Offset-based pagination
  offset: z
    .number()
    .int()
    .nonnegative()
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
  max_internal_af: z
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

  // Per-column typed filters (operator + value)
  column_filters: z
    .record(z.string(), ColumnFilterSchema)
    .nullish()
    .transform((val) => val ?? undefined),

  // Panel-based genomic interval filtering
  active_panel_ids: z
    .array(z.number().int().positive())
    .nullish()
    .transform((val) => val ?? undefined),
  panel_padding_bp: z
    .number()
    .int()
    .nonnegative()
    .max(1000000)
    .nullish()
    .transform((val) => val ?? undefined),

  // Genome build / variant type scoping (Phase 3 multi-variant-type)
  genome_build: nullishString(),
  variant_type: nullishString(),

  // Count optimization flag
  _count_needed: z.boolean().optional()
})

/**
 * Inferred type from CohortSearchParamsSchema
 * Can be used instead of manually maintaining CohortSearchParams type
 */
export type ValidatedCohortSearchParams = z.infer<typeof CohortSearchParamsSchema>

/**
 * Schema for case search/pagination parameters
 * Matches CaseSearchParams in src/main/database/types.ts
 */
export const CaseSearchParamsSchema = z.object({
  limit: z.number().int().positive().max(1000).default(50),
  offset: z.number().int().nonnegative().optional().default(0),
  sort_by: z.enum(['name', 'created_at', 'variant_count']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
  search_term: nullishString(),
  cohort_ids: z
    .array(z.number().int().positive())
    .nullish()
    .transform((val) => val ?? undefined),
  hpo_ids: z
    .array(z.string().min(1))
    .nullish()
    .transform((val) => val ?? undefined),
  _count_needed: z.boolean().optional()
})

/**
 * Inferred type from CaseSearchParamsSchema
 */
export type ValidatedCaseSearchParams = z.infer<typeof CaseSearchParamsSchema>

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
  max_internal_af: z
    .number()
    .min(0)
    .max(1)
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

  // Per-column typed filters (operator + value)
  column_filters: z
    .record(z.string(), ColumnFilterSchema)
    .nullish()
    .transform((val) => val ?? undefined),

  // Annotation scope for star/ACMG filters
  annotation_scope: z.enum(['case', 'all']).optional(),

  // Panel-based genomic interval filtering
  active_panel_ids: z
    .array(z.number().int().positive())
    .nullish()
    .transform((val) => val ?? undefined),
  panel_padding_bp: z
    .number()
    .int()
    .nonnegative()
    .max(1000000)
    .nullish()
    .transform((val) => val ?? undefined),

  // Inheritance mode filters
  inheritance_modes: z
    .array(
      z.enum([
        'homozygous',
        'heterozygous',
        'x_hemizygous',
        'candidate_compound_het',
        'de_novo',
        'autosomal_recessive',
        'compound_het'
      ])
    )
    .nullish()
    .transform((val) => val ?? undefined),
  analysis_group_id: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((val) => val ?? undefined),
  consider_phasing: z
    .boolean()
    .nullish()
    .transform((val) => val ?? undefined),

  // Variant type discriminator filter (snv, indel, sv, cnv, str)
  variant_type: z
    .enum(['snv', 'indel', 'sv', 'cnv', 'str'])
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
 * Schema for pagination offset
 */
export const OffsetSchema = z.number().int().nonnegative()

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
 * Payload for variants:columnMeta IPC channel.
 * Either caseId (single case) OR caseIds (cohort) must be provided.
 */
export const ColumnMetaPayloadSchema = z
  .object({
    caseId: z.number().int().positive().optional(),
    caseIds: z.array(z.number().int().positive()).optional(),
    columnKey: z.string().min(1)
  })
  .refine((p) => p.caseId !== undefined || (p.caseIds !== undefined && p.caseIds.length > 0), {
    message: 'Either caseId or caseIds must be provided'
  })

/**
 * Payload for variants:typesPresent IPC channel.
 * Either caseId (single case) OR caseIds (cohort) must be provided.
 */
export const TypesPresentPayloadSchema = z
  .object({
    caseId: z.number().int().positive().optional(),
    caseIds: z.array(z.number().int().positive()).optional()
  })
  .refine((p) => p.caseId !== undefined || (p.caseIds !== undefined && p.caseIds.length > 0), {
    message: 'Either caseId or caseIds must be provided'
  })

// ============================================================
// Annotation Schemas
// ============================================================

/**
 * Schema for variant coordinates (chr, pos, ref, alt)
 */
export const VariantCoordsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1)
})

/**
 * Valid ACMG classification values
 */
const AcmgClassificationSchema = z
  .enum([
    ...ACMG_CLASSIFICATIONS,
    'Likely Pathogenic',
    'VUS',
    'Likely Benign',
    'Uncertain Significance',
    'LP',
    'LB',
    'P',
    'B'
  ] as const)
  .nullish()
  .transform((val) => {
    if (val == null) return undefined
    return normalizeAcmgClassification(val) ?? undefined
  })

/**
 * Schema for global annotation updates
 */
export const GlobalAnnotationUpdatesSchema = z.object({
  global_comment: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined),
  starred: z.boolean().optional(),
  acmg_classification: AcmgClassificationSchema,
  acmg_evidence: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined),
  user_name: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Schema for per-case annotation updates
 */
export const PerCaseAnnotationUpdatesSchema = z.object({
  per_case_comment: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined),
  starred: z.boolean().optional(),
  acmg_classification: AcmgClassificationSchema,
  acmg_evidence: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined),
  user_name: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Schema for case ID + variant ID pair
 */
export const CaseVariantIdSchema = z.object({
  caseId: z.number().int().positive(),
  variantId: z.number().int().positive()
})

// ============================================================
// Database Schemas
// ============================================================

/**
 * Schema for file path validation
 */
export const FilePathSchema = z.string().min(1).max(1024)

/**
 * Schema for database open parameters
 */
export const DatabaseOpenSchema = z.object({
  path: FilePathSchema,
  password: z.string().max(256).optional()
})

/**
 * Schema for database create parameters
 */
export const DatabaseCreateSchema = z.object({
  path: FilePathSchema,
  password: z.string().max(256).optional(),
  /** First-run passphrase-setup completion; see DatabaseDomainContract.create. */
  setupPassphrase: z.string().max(256).optional()
})

/**
 * Schema for database rekey (new encryption key)
 */
export const DatabaseRekeySchema = z.object({
  newPassword: z.string().max(256)
})

/**
 * Schema for the plaintext-to-encrypted migration action. `consent` must be
 * literally `true` -- migration is never performed silently or by default.
 */
export const DatabaseMigrateToEncryptedSchema = z.object({
  consent: z.literal(true),
  recoveryPassphrase: z.string().max(256).optional()
})

/**
 * Schema for deleting a plaintext backup produced by a prior migration.
 */
export const DatabaseDeletePlaintextBackupSchema = z.object({
  backupPath: FilePathSchema
})

/**
 * Schema for setting a recovery passphrase on the current database's managed
 * key. Non-empty -- an empty recovery passphrase would be a silent no-op
 * footgun (unlike `DatabaseRekeySchema`, which allows an empty string today).
 */
export const DatabaseSetRecoveryPassphraseSchema = z.object({
  passphrase: z.string().min(1).max(256)
})

// ============================================================
// Gene List Schemas
// ============================================================

/**
 * Schema for gene list ID
 */
export const GeneListIdSchema = z.number().int().positive()

/**
 * Schema for gene list creation
 */
export const GeneListCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Schema for setting genes in a gene list
 */
export const GeneListSetGenesSchema = z.object({
  listId: z.number().int().positive(),
  genes: z.array(z.string().min(1).max(50)).max(50000)
})

/**
 * Schema for region file creation
 */
export const RegionFileCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Schema for BED file import
 */
export const BedImportSchema = z.object({
  fileId: z.number().int().positive(),
  filePath: FilePathSchema
})

// ============================================================
// Panel Schemas
// ============================================================

/**
 * Schema for panel creation
 */
export const PanelCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: nullishString(),
  version: nullishString(),
  source: z
    .enum(['manual', 'panelapp_uk', 'panelapp_aus', 'stringdb', 'bed_import'])
    .default('manual'),
  sourceId: nullishString(),
  sourceMetadata: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Schema for panel update
 */
export const PanelUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional()
})

/**
 * Schema for setting genes on a panel
 */
export const PanelGenesSchema = z.object({
  panelId: z.number().int().positive(),
  genes: z.array(z.object({ hgncId: z.string().min(1), symbol: z.string().min(1) })).max(50000)
})

/**
 * Schema for activating a panel on a case
 */
export const PanelActivateSchema = z.object({
  caseId: z.number().int().positive(),
  panelId: z.number().int().positive(),
  paddingBp: z.number().int().nonnegative().max(1000000).default(5000)
})

/**
 * Schema for deactivating a panel on a case
 */
export const PanelDeactivateSchema = z.object({
  caseId: z.number().int().positive(),
  panelId: z.number().int().positive()
})

/**
 * Schema for validating gene symbols
 */
export const ValidateSymbolsSchema = z.object({
  symbols: z.array(z.string().min(1)).max(50000)
})

/**
 * Schema for gene autocomplete
 */
export const AutocompleteSchema = z.object({
  query: z.string().min(1).max(100),
  limit: z.number().int().positive().max(50).default(20)
})

/**
 * Schema for panel duplication
 */
export const PanelDuplicateSchema = z.object({
  id: z.number().int().positive(),
  newName: z.string().min(1).max(200)
})

/**
 * Schema for panel ID
 */
export const PanelIdSchema = z.number().int().positive()

// ============================================================
// PanelApp / StringDB Import Schemas
// ============================================================

/**
 * Schema for searching PanelApp panels
 */
export const PanelAppSearchSchema = z.object({
  keyword: z.string().min(1).max(200),
  region: z.enum(['uk', 'aus', 'both']).default('both')
})

/**
 * Schema for importing a panel from PanelApp
 */
export const PanelAppImportSchema = z.object({
  panelId: z.number().int().positive(),
  region: z.enum(['uk', 'aus']),
  confidenceThreshold: z.enum(['green', 'green_amber', 'all']).default('green'),
  name: z.string().min(1).max(200).optional()
})

/**
 * Schema for generating a panel from StringDB interactions
 */
export const StringDbGenerateSchema = z.object({
  seedGenes: z.array(z.string().min(1)).min(1).max(500),
  requiredScore: z.number().int().min(0).max(1000).default(400),
  networkType: z.enum(['physical', 'functional']).default('physical'),
  name: z.string().min(1).max(200).optional()
})

/**
 * Schema for exporting a panel as a BED file
 */
export const PanelExportBedSchema = z.object({
  panelId: z.number().int().positive(),
  assembly: z.string().min(1),
  paddingBp: z.number().int().nonnegative().default(0)
})

// ============================================================
// Association Schemas
// ============================================================

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
    gene_list: z.array(z.string()).optional(),
    // Parity fields with Paths 1/2 (FilterIpcParams subset)
    clinvars: z.array(z.string()).optional(),
    funcs: z.array(z.string()).optional(),
    acmg_classifications: z.array(z.string()).optional(),
    max_internal_af: z.number().min(0).max(1).optional(),
    column_filters: z.record(z.string(), ColumnFilterSchema).optional()
  }),
  max_threads: z.number().int().min(1).max(64).default(4)
})

// ============================================================
// Filter State Schema (shared by presets + shortlist)
// ============================================================

/**
 * Runtime schema for `FilterState` — the tab-level filter surface
 * shared by single-case and cohort views.
 *
 * This schema exists primarily so `ShortlistConfigSchema` can nest
 * `FilterStateSchema.partial()` to validate `baseFilters` and
 * `perTypeOverrides` at the IPC boundary. The optional `shortlist` field
 * on `FilterState` would be mutually recursive with `ShortlistConfigSchema`
 * — the recursion is cut here by typing it as `z.unknown().optional()`
 * (see the field-level comment on `shortlist` below).
 *
 * Fields mirror `src/shared/types/filters.ts#FilterState`. Arrays default
 * loose (no `min(1)`) because empty arrays are a legitimate state. All
 * fields are required to match the TypeScript interface; callers that
 * want "partial" validation should use `.partial()`.
 */
export const FilterStateSchema = z.object({
  geneSymbol: z.string(),
  searchQuery: z.string(),
  consequences: z.array(z.string()),
  funcs: z.array(z.string()),
  clinvars: z.array(z.string()),
  maxGnomadAf: z.number().min(0).max(1).nullable(),
  minCadd: z.number().min(0).max(DOMAIN_CONFIG.MAX_CADD_SCORE).nullable(),
  minCarriers: z.number().int().nonnegative().nullable(),
  starredOnly: z.boolean(),
  hasCommentOnly: z.boolean(),
  acmgClassifications: z.array(z.string()),
  tagIds: z.array(z.number().int().positive()),
  annotationScope: z.enum(['case', 'all']),
  activePanelIds: z.array(z.number().int().positive()),
  panelPaddingBp: z.number().int().nonnegative(),
  maxInternalAf: z.number().min(0).max(1).nullable(),
  inheritanceModes: z.array(z.string()),
  analysisGroupId: z.number().int().positive().nullable(),
  considerPhasing: z.boolean(),
  columnFilters: z.record(z.string(), ColumnFilterSchema),
  /**
   * Shortlist configuration, present only on presets with `kind='shortlist'`.
   *
   * Kept as `z.unknown()` here to avoid a mutual-recursion cycle with
   * `ShortlistConfigSchema` (which nests `FilterStateSchema.partial()`
   * for its `baseFilters` / `perTypeOverrides` fields). Callers that
   * need strict validation of a shortlist payload should use
   * `ShortlistConfigSchema` directly — that is the path every IPC
   * handler takes via `GetShortlistParamsSchema`.
   */
  shortlist: z.unknown().optional()
})

// ============================================================
// Shortlist Schemas
// ============================================================

/**
 * Zod enum matching `VariantTypeKey` in `src/shared/types/shortlist.ts`.
 */
const VariantTypeKeySchema = z.enum(['snv', 'indel', 'sv', 'cnv', 'str'])

/**
 * Schema for `RankWeights` — every ranking sub-score weight clamped to
 * [0, 100] at the IPC boundary.
 */
export const RankWeightsSchema = z.object({
  impact: z.number().min(0).max(100),
  pathogenicity: z.number().min(0).max(100),
  rarity: z.number().min(0).max(100),
  clinvar: z.number().min(0).max(100),
  phenotype: z.number().min(0).max(100)
})

/**
 * Schema for `RankConfig` — weights plus optional pinning rules.
 */
export const RankConfigSchema = z.object({
  weights: RankWeightsSchema,
  clinvarPinTop: z.boolean().optional(),
  pinStarredTop: z.boolean().optional()
})

/**
 * Schema for `ShortlistConfig` — the full self-contained shortlist spec.
 *
 * - `topN` hard-capped at 500 to prevent Electron IPC pathologies
 *   (`electron/electron#7286`).
 * - `tieBreakers` hard-capped at 10 so users can't construct
 *   pathologically long sort chains.
 */
// `baseFilters` and `perTypeOverrides` validate a partial `FilterState`
// snapshot — but the `shortlist` field on `FilterState` is a mutually-
// recursive nest into this very schema, which has no meaning inside
// `baseFilters` itself. We `.omit({ shortlist: true })` before `.partial()`
// so the base-filter surface does not carry a harmless-but-meaningless
// opaque key on every payload.
const BaseFilterStateSchema = FilterStateSchema.omit({ shortlist: true }).partial()

export const ShortlistConfigSchema = z.object({
  variantTypeScope: z.array(VariantTypeKeySchema).optional(),
  baseFilters: BaseFilterStateSchema,
  // `partialRecord` (not `record`) so presets can specify overrides for a
  // subset of variant types — e.g. the "Tier 1 candidates" built-in only
  // sets sv/cnv/str, leaving snv/indel to fall through to `baseFilters`.
  // Zod 4's `z.record(enum, value)` treats missing enum keys as validation
  // failures, which is the opposite of what the shortlist pipeline wants.
  perTypeOverrides: z.partialRecord(VariantTypeKeySchema, BaseFilterStateSchema).optional(),
  topN: z.number().int().min(1).max(500),
  tieBreakers: z.array(SortItemSchema).max(10).optional(),
  rankConfig: RankConfigSchema
})

/**
 * Inferred type from `ShortlistConfigSchema`.
 */
export type ValidatedShortlistConfig = z.infer<typeof ShortlistConfigSchema>

/**
 * Discriminated union schema for the `variants:shortlist` IPC handler.
 *
 * Callers supply EITHER a `presetId` (server loads the preset and runs
 * its stored `ShortlistConfig`) OR an `adHocConfig` (typically the
 * preset editor's live preview). Both branches require a positive
 * `caseId`.
 *
 * Both branches are `.strict()` so an ambiguous payload that carries
 * BOTH `presetId` AND `adHocConfig` is rejected instead of being
 * silently coerced into one branch. Without `.strict()`, Zod's default
 * strip behavior would match the first branch and drop the second
 * field, masking caller-side bugs.
 */
export const GetShortlistParamsSchema = z.union([
  z
    .object({
      caseId: z.number().int().positive(),
      presetId: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      caseId: z.number().int().positive(),
      adHocConfig: ShortlistConfigSchema
    })
    .strict()
])

/**
 * Inferred type from `GetShortlistParamsSchema`.
 */
export type ValidatedGetShortlistParams = z.infer<typeof GetShortlistParamsSchema>

// ============================================================
// Filter Preset Schemas
// ============================================================

/** Discriminator for filter presets — `'filter'` | `'shortlist'`. */
export const FilterPresetKindSchema = z.enum(['filter', 'shortlist'])

export const FilterPresetIdSchema = z.number().int().positive()

export const FilterPresetCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z
    .string()
    .max(500)
    .nullish()
    .transform((val) => val ?? null),
  filterJson: z.record(z.string(), z.unknown()),
  kind: FilterPresetKindSchema.optional(),
  isVisible: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0)
})

export const FilterPresetUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  filterJson: z.record(z.string(), z.unknown()).optional(),
  kind: FilterPresetKindSchema.optional(),
  isVisible: z.boolean().optional(),
  sortOrder: z.number().int().optional()
})

/**
 * Runtime schema for a normalized `FilterPreset` object (NOT a raw DB
 * row). Raw rows must first be passed through
 * `FilterPresetRepository.rowToPreset`, which applies the pre-v27
 * backfill (`kind` defaults to `'filter'` when the column is absent or
 * `NULL`). This schema validates the post-repository shape, including
 * the `kind` discriminator introduced by migration v27.
 */
export const FilterPresetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100),
  description: z.string().nullable(),
  filterJson: z.record(z.string(), z.unknown()),
  kind: FilterPresetKindSchema,
  isBuiltIn: z.boolean(),
  isVisible: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})

export const FilterPresetReorderSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    sortOrder: z.number().int()
  })
)

// ============================================================
// Analysis Group Schemas
// ============================================================

/**
 * Schema for analysis group creation
 */
export const AnalysisGroupCreateSchema = z.object({
  name: z.string().min(1).max(200),
  groupType: z.enum(['family', 'tumor_normal']).default('family'),
  description: z
    .string()
    .max(1000)
    .nullish()
    .transform((val) => val ?? undefined)
})

/**
 * Schema for analysis group update
 */
export const AnalysisGroupUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional()
})

/**
 * Schema for adding a member to an analysis group
 */
export const AnalysisGroupMemberAddSchema = z.object({
  groupId: z.number().int().positive(),
  caseId: z.number().int().positive(),
  role: z.enum(['proband', 'father', 'mother', 'sibling', 'partner', 'other', 'tumor', 'normal']),
  affectedStatus: z.enum(['affected', 'unaffected', 'unknown']).default('unknown'),
  individualId: z
    .string()
    .nullish()
    .transform((val) => val ?? undefined)
})
