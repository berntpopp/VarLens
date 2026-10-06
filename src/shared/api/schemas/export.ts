import { z } from 'zod'

import {
  CaseIdSchema,
  CohortSearchParamsSchema,
  VariantFilterPartialSchema
} from '../../types/ipc-schemas'

export { CaseIdSchema, CohortSearchParamsSchema, VariantFilterPartialSchema }

export const VariantExportParamsSchema = z.object({
  caseId: CaseIdSchema,
  filters: VariantFilterPartialSchema,
  caseName: z.string().min(1).max(500)
})

const ExportVariantFilterOpenApiSchema = z.record(z.string(), z.unknown())
const ExportCohortSearchOpenApiSchema = z.record(z.string(), z.unknown())

export const ExportInvokeBodySchemas = {
  variants: z.object({
    args: z.tuple([CaseIdSchema, ExportVariantFilterOpenApiSchema, z.string().min(1).max(500)])
  }),
  cohort: z.object({
    args: z.tuple([ExportCohortSearchOpenApiSchema])
  }),
  prepareDownload: z.object({
    args: z.tuple([
      z
        .object({
          kind: z.enum(['variants', 'cohort', 'panel-bed']),
          format: z.enum(['csv', 'xlsx']).optional()
        })
        .passthrough()
    ])
  })
} as const

export const PrepareDownloadResponseSchema = z.object({
  downloadPath: z.string(),
  expiresAt: z.number().int()
})

export const ExportUnknownResponseSchema = z.unknown()

export type VariantExportParams = z.infer<typeof VariantExportParamsSchema>
