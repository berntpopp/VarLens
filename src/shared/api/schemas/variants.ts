import { z } from 'zod'

import {
  CaseIdSchema,
  ColumnMetaPayloadSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
} from '../../types/ipc-schemas'

export {
  CaseIdSchema,
  ColumnMetaPayloadSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
}

export const VariantSortBySchema = z.array(SortItemSchema)

export const VariantSearchQuerySchema = z.string().min(1).max(100)

export const VariantSearchArgsSchema = z.tuple([
  CaseIdSchema,
  VariantSearchQuerySchema,
  LimitSchema.optional()
])

export const VariantColumnMetaPayloadSchema = ColumnMetaPayloadSchema

const NullishStringOpenApiSchema = z.string().nullable().optional()
const NullishStringArrayOpenApiSchema = z.array(z.string()).nullable().optional()
const NullishNumberArrayOpenApiSchema = z.array(z.number()).nullable().optional()

const VariantFilterOpenApiSchema = z.object({
  gene_symbol: NullishStringOpenApiSchema,
  search_query: NullishStringOpenApiSchema,
  consequence: NullishStringOpenApiSchema,
  consequences: NullishStringArrayOpenApiSchema,
  funcs: NullishStringArrayOpenApiSchema,
  clinvars: NullishStringArrayOpenApiSchema,
  gnomad_af_max: z.number().min(0).max(1).nullable().optional(),
  cadd_min: z.number().min(0).max(100).nullable().optional(),
  max_internal_af: z.number().min(0).max(1).nullable().optional(),
  carrier_count_max: z.number().int().min(1).nullable().optional(),
  chr: NullishStringOpenApiSchema,
  pos: z.number().int().positive().nullable().optional(),
  ref: NullishStringOpenApiSchema,
  alt: NullishStringOpenApiSchema,
  tag_ids: NullishNumberArrayOpenApiSchema,
  starred_only: z.boolean().optional(),
  has_comment: z.boolean().optional(),
  acmg_classifications: NullishStringArrayOpenApiSchema,
  column_filters: z.record(z.string(), z.unknown()).nullable().optional(),
  annotation_scope: z.enum(['case', 'all']).optional(),
  active_panel_ids: z.array(z.number().int().positive()).nullable().optional(),
  panel_padding_bp: z.number().int().nonnegative().max(1000000).nullable().optional(),
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
    .nullable()
    .optional(),
  analysis_group_id: z.number().int().positive().nullable().optional(),
  consider_phasing: z.boolean().nullable().optional(),
  variant_type: z.enum(['snv', 'indel', 'sv', 'cnv', 'str']).nullable().optional()
})

export const VariantInvokeBodySchemas = {
  search: z.object({
    args: VariantSearchArgsSchema
  }),
  columnMeta: z.object({
    args: z.tuple([VariantColumnMetaPayloadSchema])
  }),
  query: z.object({
    args: z.tuple([
      CaseIdSchema,
      VariantFilterOpenApiSchema,
      OffsetSchema.nullish().optional(),
      LimitSchema.nullish().optional(),
      VariantSortBySchema.nullish().optional(),
      z.boolean().optional(),
      z.boolean().optional()
    ])
  }),
  getFilterOptions: z.object({
    args: z.tuple([CaseIdSchema])
  })
} as const

export const VariantUnknownResponseSchema = z.unknown()

export type VariantSearchArgs = z.infer<typeof VariantSearchArgsSchema>
export type VariantColumnMetaPayload = z.infer<typeof VariantColumnMetaPayloadSchema>
