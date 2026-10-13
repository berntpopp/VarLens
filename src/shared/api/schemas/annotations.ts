import { z } from 'zod'

import { ACMG_CLASSIFICATIONS } from '../../config/domain.config'
import { GENOME_BUILDS } from '../../config/genome-builds.config'
import { OVERRIDE_REASON_REQUIRED, overrideReasonMissing } from '../../acmg/acmg-evidence'
import {
  CaseVariantIdSchema,
  GlobalAnnotationUpdatesSchema as GlobalAnnotationFieldsSchema,
  PerCaseAnnotationUpdatesSchema as PerCaseAnnotationFieldsSchema,
  VariantCoordsSchema
} from '../../types/ipc-schemas'

export { CaseVariantIdSchema, VariantCoordsSchema }

/** #567: an ACMG class saved against its evidence needs a reason, on every backend. */
function requireOverrideReason(value: unknown, ctx: z.RefinementCtx): void {
  if (value !== null && typeof value === 'object' && overrideReasonMissing(value)) {
    ctx.addIssue({
      code: 'custom',
      path: ['acmg_evidence'],
      message: OVERRIDE_REASON_REQUIRED
    })
  }
}

/** Global annotation updates (desktop IPC and web dispatcher). */
export const GlobalAnnotationUpdatesSchema = z
  .unknown()
  .superRefine(requireOverrideReason)
  .pipe(GlobalAnnotationFieldsSchema)

/** Per-case annotation updates (desktop IPC and web dispatcher). */
export const PerCaseAnnotationUpdatesSchema = z
  .unknown()
  .superRefine(requireOverrideReason)
  .pipe(PerCaseAnnotationFieldsSchema)

/**
 * Genome build of a global annotation: part of its key (#577), so only a
 * configured build id as cases store it ("grch38" would store a row no case
 * reads). Imports store only these ids; a legacy case with any other value
 * cannot write global notes until its build is corrected.
 */
export const GenomeBuildArgSchema = z
  .string()
  .refine((id) => GENOME_BUILDS.some((b) => b.id === id), 'Unknown genome build')

/** Coordinates of a global annotation, which is keyed by build too (#577). */
export const GlobalVariantCoordsSchema = VariantCoordsSchema.extend({
  genome_build: GenomeBuildArgSchema
})

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
    VariantCoordsSchema.shape.alt,
    GenomeBuildArgSchema
  ])
  .rest(z.unknown())

export const AnnotationGlobalUpsertArgsSchema = z
  .tuple([
    VariantCoordsSchema.shape.chr,
    VariantCoordsSchema.shape.pos,
    VariantCoordsSchema.shape.ref,
    VariantCoordsSchema.shape.alt,
    GlobalAnnotationUpdatesInputSchema,
    GenomeBuildArgSchema
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
