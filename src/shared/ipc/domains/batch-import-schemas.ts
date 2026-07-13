import { z } from 'zod'
import type { DuplicateChoice } from '../../types/api'

/**
 * Batch-import IPC payload schemas. Used by
 * src/main/ipc/handlers/batch-import.ts via safeParse before any file path
 * is read or forwarded to the import worker.
 *
 * File-path validation against the dialog-enrolled allowlist happens
 * separately in the handler (`isStrictlyEnrolledPath`); these schemas only
 * assert shape and primitive bounds, mirroring import-schemas.ts.
 */
const nonBlankString = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => value.trim().length > 0, {
      message: 'Required'
    })

const NonBlankFilePathSchema = nonBlankString(4096)
const StripTextSchema = z.string().max(255).optional()
const ZipPasswordSchema = z.string().max(1024)
export const BatchImportRunIdSchema = nonBlankString(128)

/** Keep in sync with `DuplicateChoice` in src/shared/types/api.ts. */
const DuplicateChoiceSchema: z.ZodType<DuplicateChoice> = z.enum(['skip', 'overwrite'])

export const BatchImportCheckDuplicatesParamsSchema = z.tuple([
  z.array(NonBlankFilePathSchema).max(5000),
  StripTextSchema
])

export const BatchImportStartParamsSchema = z.tuple([
  z.array(NonBlankFilePathSchema).max(5000),
  DuplicateChoiceSchema,
  StripTextSchema,
  BatchImportRunIdSchema
])

export const BatchImportTestZipPasswordParamsSchema = z.tuple([
  NonBlankFilePathSchema,
  ZipPasswordSchema
])

export const BatchImportExtractZipParamsSchema = z.tuple([
  NonBlankFilePathSchema,
  ZipPasswordSchema.optional()
])

export const BatchImportCleanupZipParamsSchema = z.tuple([nonBlankString(128)])
