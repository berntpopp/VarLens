import { z } from 'zod'

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

export const ImportVcfOptionsSchema = z
  .object({
    selectedSample: NonBlankImportStringSchema.optional(),
    genomeBuild: NonBlankImportStringSchema.optional()
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

export const ImportFiltersIpcPayloadSchema = z
  .object({
    bedFile: NonBlankFilePathSchema.nullable().optional(),
    bedPadding: z.number().int().nonnegative().max(1000000).optional(),
    passOnly: z.boolean().optional(),
    minQual: z.number().nonnegative().max(1000000).nullable().optional(),
    minGq: z.number().nonnegative().max(1000000).nullable().optional(),
    minDp: z.number().nonnegative().max(1000000).nullable().optional()
  })
  .strict()

export const ImportStartMultiFileParamsSchema = z.tuple([
  NonBlankImportStringSchema,
  z.array(MultiFileImportSpecSchema).min(1).max(1000),
  ImportVcfOptionsSchema,
  ImportFiltersIpcPayloadSchema.optional()
])

export const ImportVcfPreviewParamsSchema = z.tuple([NonBlankFilePathSchema])

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
