import { z } from 'zod'

import { importFilterNumericFields } from '../../ipc/domains/import-schemas'

export interface ImportVcfOptions {
  selectedSample?: string
  genomeBuild?: string
}

export interface ImportMultiFileSpec {
  filePath: string
  variantType: string
  caller: string | null
  annotationFormat: string | null
}

export const ImportServerPathArgSchema = z.string().refine((value) => value.trim() !== '')
export const ImportCaseNameArgSchema = z.string().refine((value) => value.trim() !== '')
export const ImportVariantTypeArgSchema = z.string().refine((value) => value.trim() !== '')

export const ImportVcfOptionsSchema = z
  .object({
    selectedSample: z.string().optional(),
    genomeBuild: z.string().optional()
  })
  .passthrough()

export const ImportFiltersPayloadSchema = z
  .object({
    bedFile: z.string().nullable().optional(),
    passOnly: z.boolean().optional(),
    ...importFilterNumericFields
  })
  .passthrough()

export const ImportMultiFileSpecSchema = z.object({
  filePath: z.string().min(1),
  variantType: z.string().min(1),
  caller: z.unknown().optional(),
  annotationFormat: z.unknown().optional()
})

const ImportMultiFileSpecOpenApiSchema = z.object({
  filePath: z.string().min(1),
  variantType: z.string().min(1),
  caller: z.string().nullable().optional(),
  annotationFormat: z.string().nullable().optional()
})

export const ServerPathImportDisabledSchema = z.object({
  error: z.literal('server-path-import-disabled'),
  message: z.string()
})

export const ImportInvokeBodySchemas = {
  start: z.object({
    args: z.tuple([z.string().min(1), z.string().min(1), ImportVcfOptionsSchema.optional()])
  }),
  startMultiFile: z.object({
    args: z.tuple([
      z.string().min(1),
      z.array(ImportMultiFileSpecOpenApiSchema).min(1),
      ImportVcfOptionsSchema.optional(),
      ImportFiltersPayloadSchema.optional()
    ])
  })
} as const

export const ImportUnknownResponseSchema = z.unknown()

export type ImportMultiFileSpecInput = z.infer<typeof ImportMultiFileSpecSchema>
export type ImportFiltersPayload = z.infer<typeof ImportFiltersPayloadSchema>

export function normalizeImportVcfOptions(vcfOptions: unknown): ImportVcfOptions | undefined {
  return vcfOptions !== null && typeof vcfOptions === 'object'
    ? {
        selectedSample:
          typeof (vcfOptions as { selectedSample?: unknown }).selectedSample === 'string'
            ? (vcfOptions as { selectedSample: string }).selectedSample
            : undefined,
        genomeBuild:
          typeof (vcfOptions as { genomeBuild?: unknown }).genomeBuild === 'string'
            ? (vcfOptions as { genomeBuild: string }).genomeBuild
            : undefined
      }
    : undefined
}

export function normalizeImportMultiFileSpec(input: ImportMultiFileSpecInput): ImportMultiFileSpec {
  return {
    filePath: input.filePath,
    variantType: input.variantType,
    caller: typeof input.caller === 'string' ? input.caller : null,
    annotationFormat: typeof input.annotationFormat === 'string' ? input.annotationFormat : null
  }
}

export function normalizeImportFiltersPayload(filters: unknown): ImportFiltersPayload | undefined {
  if (filters === null || typeof filters !== 'object') return undefined

  const parsed = ImportFiltersPayloadSchema.safeParse(filters)
  return parsed.success ? parsed.data : undefined
}
