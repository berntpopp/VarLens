import { z } from 'zod'

import { ACMG_CLASSIFICATIONS } from '../../config/domain.config'
import {
  CaseVariantIdSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  VariantCoordsSchema
} from '../../types/ipc-schemas'

export {
  CaseVariantIdSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  VariantCoordsSchema
}

/** Variant keys of one `annotations:batchGet` call (desktop IPC and web dispatcher). */
export const VariantKeysSchema = z.array(
  VariantCoordsSchema.extend({ variantId: z.number().int().positive().optional() })
)

const AcmgClassificationInputSchema = z
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

const GlobalAnnotationUpdatesInputSchema = z.object({
  global_comment: z.string().nullish(),
  starred: z.boolean().optional(),
  acmg_classification: AcmgClassificationInputSchema,
  acmg_evidence: z.string().nullish(),
  user_name: z.string().nullish()
})

const PerCaseAnnotationUpdatesInputSchema = z.object({
  per_case_comment: z.string().nullish(),
  starred: z.boolean().optional(),
  acmg_classification: AcmgClassificationInputSchema,
  acmg_evidence: z.string().nullish(),
  user_name: z.string().nullish()
})

export const AnnotationCoordsArgsSchema = z
  .tuple([
    VariantCoordsSchema.shape.chr,
    VariantCoordsSchema.shape.pos,
    VariantCoordsSchema.shape.ref,
    VariantCoordsSchema.shape.alt
  ])
  .rest(z.unknown())

export const AnnotationGlobalUpsertArgsSchema = z
  .tuple([
    VariantCoordsSchema.shape.chr,
    VariantCoordsSchema.shape.pos,
    VariantCoordsSchema.shape.ref,
    VariantCoordsSchema.shape.alt,
    GlobalAnnotationUpdatesInputSchema
  ])
  .rest(z.unknown())

export const AnnotationPerCaseUpsertArgsSchema = z
  .tuple([
    CaseVariantIdSchema.shape.caseId,
    CaseVariantIdSchema.shape.variantId,
    PerCaseAnnotationUpdatesInputSchema
  ])
  .rest(z.unknown())

export const AnnotationForVariantArgsSchema = z
  .tuple([
    CaseVariantIdSchema.shape.caseId,
    VariantCoordsSchema.shape.chr,
    VariantCoordsSchema.shape.pos,
    VariantCoordsSchema.shape.ref,
    VariantCoordsSchema.shape.alt
  ])
  .rest(z.unknown())

export const AnnotationInvokeBodySchemas = {
  getGlobal: z.object({
    args: AnnotationCoordsArgsSchema
  }),
  upsertGlobal: z.object({
    args: AnnotationGlobalUpsertArgsSchema
  }),
  upsertPerCase: z.object({
    args: AnnotationPerCaseUpsertArgsSchema
  }),
  getForVariant: z.object({
    args: AnnotationForVariantArgsSchema
  })
} as const

export const AnnotationUnknownResponseSchema = z.unknown()
