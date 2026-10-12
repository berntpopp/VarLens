import { z } from 'zod'

import {
  IMPORT_FIELD_PROFILE_LIMITS,
  type ImportFieldProfile
} from '../../config/import-fields.config'

/**
 * Import IPC payload schemas. Used by src/main/ipc/handlers/import.ts via
 * safeParse before any business logic runs.
 *
 * File-path validation is enforced separately in BedFilter.fromFile and
 * the import handler; these schemas only assert shape and primitive bounds.
 */
const nonBlankString = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => value.trim().length > 0, {
      message: 'Required'
    })

const NonBlankFilePathSchema = nonBlankString(4096)
const NonBlankImportStringSchema = nonBlankString(255)
const DroppedFileEnrollmentTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)

/** An import field profile (src/shared/config/import-fields.config.ts); keys are normalised on use. */
export const ImportFieldProfileSchema: z.ZodType<ImportFieldProfile> = z
  .object({
    keepUnknown: z.enum(['all', 'selected', 'none']),
    fields: z
      .record(
        z.string().min(1).max(IMPORT_FIELD_PROFILE_LIMITS.maxNameChars),
        z.object({ keep: z.boolean(), key: z.string().min(1).max(64).optional() }).strict()
      )
      .refine((fields) => Object.keys(fields).length <= IMPORT_FIELD_PROFILE_LIMITS.maxFields, {
        message: `At most ${IMPORT_FIELD_PROFILE_LIMITS.maxFields} field choices`
      })
  })
  .strict()

export const ImportVcfOptionsSchema = z
  .object({
    selectedSample: NonBlankImportStringSchema.optional(),
    genomeBuild: NonBlankImportStringSchema.optional(),
    fieldProfile: ImportFieldProfileSchema.optional()
  })
  .strict()
  .optional()

export const ImportStartParamsSchema = z.tuple([
  NonBlankFilePathSchema,
  NonBlankImportStringSchema,
  ImportVcfOptionsSchema
])

const MultiFileImportSpecSchema = z
  .object({
    filePath: NonBlankFilePathSchema,
    variantType: NonBlankImportStringSchema,
    caller: NonBlankImportStringSchema.nullable(),
    annotationFormat: NonBlankImportStringSchema.nullable()
  })
  .strict()

/** Numeric bounds of the import filters, shared with the web schema (src/shared/api/schemas/import.ts). */
export const importFilterNumericFields = {
  bedPadding: z.number().int().nonnegative().max(1000000).optional(),
  minQual: z.number().nonnegative().max(1000000).nullable().optional(),
  minGq: z.number().nonnegative().max(1000000).nullable().optional(),
  minDp: z.number().nonnegative().max(1000000).nullable().optional()
}

export const ImportFiltersIpcPayloadSchema = z
  .object({
    bedFile: NonBlankFilePathSchema.nullable().optional(),
    passOnly: z.boolean().optional(),
    ...importFilterNumericFields
  })
  .strict()

export const ImportStartMultiFileParamsSchema = z.tuple([
  NonBlankImportStringSchema,
  z.array(MultiFileImportSpecSchema).min(1).max(1000),
  ImportVcfOptionsSchema,
  ImportFiltersIpcPayloadSchema.optional()
])

export const ImportVcfPreviewParamsSchema = z.tuple([NonBlankFilePathSchema])

export const ImportJsonPreviewParamsSchema = z.tuple([NonBlankFilePathSchema])

export const ImportVcfMultiPreviewParamsSchema = z.tuple([
  z.array(NonBlankFilePathSchema).min(1).max(1000)
])

export const ImportRegisterDroppedFileEnrollmentTokenParamsSchema = z.tuple([
  DroppedFileEnrollmentTokenSchema
])

export const ImportEnrollDroppedFilesParamsSchema = z.tuple([
  z
    .object({
      token: DroppedFileEnrollmentTokenSchema,
      filePaths: z.array(NonBlankFilePathSchema).max(1000)
    })
    .strict()
])
